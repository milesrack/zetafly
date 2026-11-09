"""Export independent runtime parity cases and destructive neural ablations."""

import argparse
import copy
import json
from pathlib import Path

import numpy as np
import torch
from model import (
    OUTPUT_SCALES,
    Brain,
    encode,
    evaluate,
    prepare_brain,
    split_examples,
)

parser = argparse.ArgumentParser()
parser.add_argument("--model", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=False)
torch.set_num_threads(4)
nodes, matrices, hashes = prepare_brain()
# Load directly into float64 parameters: converting after loading loses precision.
model = Brain(matrices).double()
model.load_state_dict(torch.load(args.model, weights_only=True))
banks = split_examples()
random = np.random.default_rng(20261107)
extra = []
for a, b in random.integers(101, 121, (250, 2)):
    a, b = int(a), int(b)
    extra.extend(
        [(a, b, 0, a + b), (a + b, a, 1, b), (a, b, 2, a * b), (a * b, a, 3, b)]
    )


@torch.no_grad()
def reference(rows):
    values, _ = encode(rows)
    predictions = model(values.double()).numpy()
    return [
        {
            "expression": f"{a}{'+-*/'[operation]}{b}",
            "expected": str(answer),
            "estimate": float(predictions[index, operation] * OUTPUT_SCALES[operation]),
        }
        for index, (a, b, operation, answer) in enumerate(rows)
    ]


cases = {
    "validation": reference(banks[1]),
    "test": reference(banks[2]),
    "extrapolation": reference(extra),
}
(args.output / "reference.json").write_text(json.dumps(cases))
validation = tuple(tensor.double() for tensor in encode(banks[1]))
original = copy.deepcopy(model.state_dict())
fresh = Brain(matrices).double()
for index, layer in enumerate(model.layers):
    layer.load_state_dict(fresh.layers[index].state_dict())
reset = evaluate(model, banks[1], validation)
model.load_state_dict(original)
with torch.no_grad():
    model.layers[1].sign.zero_()
severed = evaluate(model, banks[1], validation)
ablations = {"resetInternalSynapses": reset, "severInternalLayer": severed}
(args.output / "ablations.json").write_text(json.dumps(ablations, indent=2))
print(json.dumps(ablations))
