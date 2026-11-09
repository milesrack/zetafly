"""Bounded CPU training and validation-only selection for the fly subcircuit."""

import argparse
import copy
import hashlib
import json
import subprocess
import time
from pathlib import Path

import numpy as np
import torch
from model import (
    OUTPUT_SCALES,
    Brain,
    encode,
    evaluate,
    export_checkpoint,
    prepare_brain,
    split_examples,
)

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--steps", type=int, default=20000)
parser.add_argument("--seconds", type=float, default=60)
args = parser.parse_args()
if args.steps < 100 or args.steps > 20000 or not 0 < args.seconds <= 300:
    parser.error("Use 100–20000 steps and a positive budget of at most 300 seconds")
args.output.mkdir(parents=True, exist_ok=False)
torch.set_num_threads(4)
torch.manual_seed(42)
started = time.monotonic()
nodes, matrices, hashes = prepare_brain()
banks = split_examples()
data = [encode(rows) for rows in banks]
model = Brain(matrices)
optimiser = torch.optim.Adam(model.parameters(), lr=0.003)
best = evaluate(model, banks[1], data[1])
checkpoint = copy.deepcopy(model.state_dict())
selected = 0
curve = []
training_started = time.monotonic()
for step in range(1, args.steps + 1):
    indices = torch.randint(len(data[0][0]), (256,))
    values, labels = data[0][0][indices], data[0][1][indices]
    output = model(values)
    loss = ((output - labels) * values[:, 2:]).square().sum() / len(values)
    optimiser.zero_grad()
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1)
    optimiser.step()
    if step % 100 == 0:
        result = evaluate(model, banks[1], data[1])
        curve.append({"step": step, **result})
        if result["loss"] < best["loss"]:
            best, selected = result, step
            checkpoint = copy.deepcopy(model.state_dict())
        if step % 1000 == 0:
            print(
                json.dumps(
                    {
                        "step": step,
                        "correct": result["correct"],
                        "total": result["total"],
                    }
                ),
                flush=True,
            )
        if (
            time.monotonic() - training_started > args.seconds
            or step - selected >= 5000
        ):
            break
model.load_state_dict(checkpoint)
model.double()
data = [(values.double(), labels.double()) for values, labels in data]
with torch.no_grad():
    activity = torch.cat(
        [
            model.activity(data[0][0][start : start + 512])
            for start in range(0, len(banks[0]), 512)
        ]
    ).numpy()
head_curve = []
best_head = None
for cutoff in [1e-4, 1e-6, 1e-8, 1e-10, 1e-12]:
    norms = []
    for operation in range(4):
        mask = np.array([row[2] == operation for row in banks[0]])
        design = np.column_stack((activity[mask], np.ones(mask.sum())))
        labels = np.array(
            [
                row[3] / OUTPUT_SCALES[operation]
                for row in banks[0]
                if row[2] == operation
            ]
        )
        coefficients = np.linalg.lstsq(design, labels, rcond=cutoff)[0]
        with torch.no_grad():
            model.motor.weight[operation].copy_(torch.tensor(coefficients[:-1]))
            model.motor.bias[operation] = float(coefficients[-1])
        norms.append(float(np.linalg.norm(coefficients)))
    result = evaluate(model, banks[1], data[1])
    head_curve.append({"cutoff": cutoff, "coefficientNorms": norms, **result})
    if best_head is None or result["correct"] > best_head["correct"]:
        best_head = result
        checkpoint = copy.deepcopy(model.state_dict())
model.load_state_dict(checkpoint)
# Test labels are first inspected after all training and selection have ended.
test = evaluate(model, banks[2], data[2])
report = {
    "scope": "Learnt feed-forward subcircuit of actual fly connections, not a full recurrent or biophysical fly brain",
    "seed": 42,
    "dtype": "float64 inference",
    "trainingExamples": len(banks[0]),
    "neurons": [len(layer) for layer in nodes],
    "connections": [int(np.count_nonzero(matrix)) for matrix in matrices],
    "selectedTrainingStep": selected,
    "trainingCurve": curve,
    "headSelection": head_curve,
    "validation": best_head,
    "test": test,
    "seconds": time.monotonic() - started,
    "torch": torch.__version__,
    "numpy": np.__version__,
    "sourceHashes": {
        str(path): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in Path("research/connectome-arithmetic").glob("*.py")
    },
}
(args.output / "weights.json").write_text(
    json.dumps(export_checkpoint(model, nodes, hashes), separators=(",", ":"))
)
subprocess.run(
    [
        "node",
        "scripts/export-weights.ts",
        "--input",
        str(args.output / "weights.json"),
        "--output",
        str(args.output / "weights.npz"),
    ],
    check=True,
)
torch.save(model.state_dict(), args.output / "weights.pt")
(args.output / "evaluation.json").write_text(json.dumps(report, indent=2))
print(
    json.dumps({"validation": best_head, "test": test, "seconds": report["seconds"]}),
    flush=True,
)
