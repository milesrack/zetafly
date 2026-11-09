"""Rate-neuron subcircuit without a built-in arithmetic solver."""

import hashlib
import json
import subprocess
from itertools import pairwise
from pathlib import Path

import numpy as np
import torch
from torch import nn

OUTPUT_SCALES = np.array([200, 100, 10000, 100], np.float32)


def prepare_brain():
    manifest = json.loads(Path("research/data/graph.json").read_text())
    for name, expected in manifest["hashes"].items():
        actual = hashlib.sha256(
            Path(f"research/data/{name}.bin").read_bytes()
        ).hexdigest()
        if actual != expected:
            raise ValueError(f"Connectome hash mismatch: {name}")
    anatomy = json.loads(
        subprocess.check_output(
            [
                "node",
                "--input-type=module",
                "-e",
                'import {loadAnatomy} from "./server/brain/anatomy.ts"; console.log(JSON.stringify(await loadAnatomy()));',
            ],
            text=True,
        )
    )
    offsets = np.fromfile("research/data/offsets.bin", dtype="<u4")
    edges = np.fromfile("research/data/edges.bin", dtype="<u4")
    post = np.fromfile("research/data/post.bin", dtype="<u4")[edges]
    weights = np.fromfile("research/data/weights.bin", dtype="<f8")[edges]
    pre = np.repeat(np.arange(len(offsets) - 1, dtype=np.int32), np.diff(offsets))
    count = len(offsets) - 1
    sensory = np.array(anatomy["sensory"])
    motor = np.array(anatomy["readout"])
    from_sensory = np.isin(pre, sensory)
    to_motor = np.isin(post, motor)
    incoming = np.bincount(
        post[from_sensory], weights=np.abs(weights[from_sensory]), minlength=count
    )
    outgoing = np.bincount(
        pre[to_motor], weights=np.abs(weights[to_motor]), minlength=count
    )
    allowed = np.ones(count, dtype=bool)
    allowed[sensory] = False
    allowed[motor] = False
    candidates = np.flatnonzero(allowed & (outgoing > 0))
    to_candidates = np.isin(post, candidates)
    future = np.bincount(
        pre[to_candidates],
        weights=np.abs(weights[to_candidates])
        * np.log1p(outgoing[post[to_candidates]]),
        minlength=count,
    )
    score = np.log1p(incoming) * np.log1p(future) * allowed
    first = np.argsort(score)[-512:]
    first = first[score[first] > 0]
    from_first = np.isin(pre, first)
    incoming = np.bincount(
        post[from_first], weights=np.abs(weights[from_first]), minlength=count
    )
    allowed[first] = False
    score = np.log1p(incoming) * np.log1p(outgoing) * allowed
    second = np.argsort(score)[-512:]
    second = second[score[second] > 0]
    to_first = np.isin(post, first)
    strength = np.bincount(
        pre[to_first], weights=np.abs(weights[to_first]), minlength=count
    )
    sensory = sensory[np.argsort(strength[sensory])[-256:]]
    from_second = np.isin(pre, second)
    strength = np.bincount(
        post[from_second], weights=np.abs(weights[from_second]), minlength=count
    )
    motor = motor[np.argsort(strength[motor])[-128:]]
    nodes = [sensory, first, second, motor]
    matrices = []
    for source, target in pairwise(nodes):
        source_index = np.full(count, -1)
        target_index = np.full(count, -1)
        source_index[source] = np.arange(len(source))
        target_index[target] = np.arange(len(target))
        keep = (source_index[pre] >= 0) & (target_index[post] >= 0)
        matrix = np.zeros((len(target), len(source)), np.float32)
        np.add.at(
            matrix, (target_index[post[keep]], source_index[pre[keep]]), weights[keep]
        )
        matrices.append(matrix)
    return nodes, matrices, manifest["hashes"]


class Synapses(nn.Module):
    def __init__(self, weights):
        super().__init__()
        self.register_buffer("sign", torch.tensor(np.sign(weights)))
        norm = np.sqrt((weights * weights).sum(1, keepdims=True)).clip(1)
        self.log = nn.Parameter(torch.tensor(np.log((abs(weights) / norm).clip(1e-6))))
        self.bias = nn.Parameter(torch.zeros(weights.shape[0]))

    def forward(self, values):
        weights = self.sign * self.log.clamp(-14, 3).exp()
        return torch.tanh(nn.functional.linear(values, weights, self.bias))


class Brain(nn.Module):
    def __init__(self, matrices):
        super().__init__()
        self.sensory = nn.Linear(6, matrices[0].shape[1])
        self.layers = nn.ModuleList([Synapses(matrix) for matrix in matrices])
        self.motor = nn.Linear(matrices[-1].shape[0], 4)

    def activity(self, values):
        values = torch.tanh(self.sensory(values))
        for layer in self.layers:
            values = layer(values)
        return values

    def forward(self, values):
        return self.motor(self.activity(values))


def split_examples(low=2, high=100):
    banks = [[], [], []]
    for a in range(low, high + 1):
        for b in range(low, high + 1):
            digest = 2166136261
            for symbol in f"{min(a, b)}:{max(a, b)}":
                digest = ((digest ^ ord(symbol)) * 16777619) & 0xFFFFFFFF
            bucket = digest % 10
            split = 0 if bucket < 8 else 1 if bucket == 8 else 2
            banks[split].extend(
                [(a, b, 0, a + b), (a + b, a, 1, b), (a, b, 2, a * b), (a * b, a, 3, b)]
            )
    return banks


def encode(rows):
    values = np.zeros((len(rows), 6), np.float32)
    labels = np.zeros((len(rows), 4), np.float32)
    for index, (a, b, operation, answer) in enumerate(rows):
        values[index, 0] = a / [100, 200, 100, 10000][operation]
        values[index, 1] = b / 100
        values[index, 2 + operation] = 1
        labels[index, operation] = answer / OUTPUT_SCALES[operation]
    return torch.tensor(values), torch.tensor(labels)


@torch.no_grad()
def evaluate(model, rows, data):
    values, labels = data
    predictions = []
    loss = 0
    for start in range(0, len(values), 512):
        batch = values[start : start + 512]
        output = model(batch)
        predictions.append((output * batch[:, 2:]).sum(1))
        loss += float(
            ((output - labels[start : start + 512]) * batch[:, 2:]).square().sum()
        )
    operation = np.array([row[2] for row in rows])
    expected = np.array([row[3] for row in rows])
    estimates = torch.cat(predictions).numpy() * OUTPUT_SCALES[operation]
    errors = abs(estimates - expected)
    correct = errors < 0.5
    return {
        "correct": int(correct.sum()),
        "total": len(rows),
        "loss": loss / len(rows),
        "withinThreeCandidates": int(
            (abs(np.floor(estimates + 0.5) - expected) <= 1).sum()
        ),
        "byOperation": {
            symbol: {
                "correct": int(correct[operation == index].sum()),
                "total": int((operation == index).sum()),
                "meanAbsoluteError": float(errors[operation == index].mean()),
            }
            for index, symbol in enumerate("+-*/")
        },
    }


def export_checkpoint(model, nodes, hashes):
    state = model.state_dict()
    layers = []
    for index in range(3):
        weights = (
            state[f"layers.{index}.sign"]
            * state[f"layers.{index}.log"].clamp(-14, 3).exp()
        ).numpy()
        targets, sources = np.nonzero(weights)
        layers.append(
            {
                "sources": sources.tolist(),
                "targets": targets.tolist(),
                "weights": weights[targets, sources].tolist(),
                "bias": state[f"layers.{index}.bias"].tolist(),
            }
        )
    return {
        "format": "fly-brain-v1",
        "nodes": [layer.tolist() for layer in nodes],
        "layers": layers,
        "encoder": state["sensory.weight"].tolist(),
        "encoderBias": state["sensory.bias"].tolist(),
        "decoder": state["motor.weight"].tolist(),
        "decoderBias": state["motor.bias"].tolist(),
        "graphHashes": hashes,
    }
