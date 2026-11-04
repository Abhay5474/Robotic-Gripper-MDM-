"""Synthetic ("dummy") grasp-trial dataset for the ML Lab.

Every row is one simulated calibration: an object was tested at increasing force steps until it was
held and lifted, and the force that first held is the label. The numbers come from a physics model
with noise and a few hidden effects the simple formula does not know about, so there is something
for a model to learn. They are NOT measurements from a real gripper.

Hidden effects (the model is never told these, it has to learn them from the rows):
  * the estimated friction coefficient is wrong by a material-specific factor (glass and ceramic
    are slipperier than estimated, rubber and foam grippier),
  * narrow objects touch less pad area and need extra force,
  * measurement noise, and the slider step (0.5 N, or 0.25 N for fragile objects).
"""
from __future__ import annotations

import csv
import math
import random
from pathlib import Path

G = 9.81
LIFT_ACCEL = 2.0  # m/s^2, same demo value as the GripSense gripper limits
FINGERS = 2
MIN_FORCE = 1.0

# material -> (typical estimated mu, hidden true/estimated ratio)
MATERIALS: dict[str, tuple[float, float]] = {
    "plastic": (0.40, 0.92), "aluminum": (0.35, 0.88), "wood": (0.45, 1.05), "cardboard": (0.50, 1.00),
    "rubber": (0.90, 1.12), "ceramic": (0.50, 0.85), "glass": (0.30, 0.80), "steel": (0.25, 0.90),
    "foam": (0.70, 1.08), "paper": (0.45, 0.97),
}
FRAGILITY = ("robust", "moderate", "fragile")
COLUMNS = ["trial_id", "material", "mass_g", "width_mm", "height_mm", "friction_coefficient", "fragility",
           "min_holding_force_n", "tests_needed"]


def material_of(text: str) -> str:
    """Maps free-text material names (e.g. 'PET plastic', 'thin glass') onto the dataset's materials."""
    t = text.lower()
    for m in MATERIALS:
        if m in t:
            return m
    return "plastic"


def physics_required(mass_g: float, mu: float) -> float:
    """The plain Coulomb formula GripSense uses: N = m(g+a) / (n * mu)."""
    return (mass_g / 1000) * (G + LIFT_ACCEL) / (FINGERS * mu)


def true_min_force(mass_g: float, width_mm: float, mu_est: float, material: str, rng: random.Random | None = None) -> float:
    """Ground truth of the simulator (before the slider-step rounding); rng=None gives the noise-free value."""
    ratio = MATERIALS[material][1]
    mu_true = mu_est * ratio * (math.exp(rng.gauss(0, 0.06)) if rng else 1.0)
    contact = 1 + 0.25 * max(0.0, (50 - width_mm) / 50)
    noise = rng.gauss(1, 0.03) if rng else 1.0
    return physics_required(mass_g, mu_true) * contact * noise


def generate(n: int = 900, seed: int = 42) -> list[dict]:
    rng = random.Random(seed)
    rows = []
    for i in range(n):
        material = rng.choice(list(MATERIALS))
        mu_est = round(min(1.5, max(0.12, rng.gauss(MATERIALS[material][0], 0.06))), 2)
        mass = round(math.exp(rng.uniform(math.log(40), math.log(2000))))
        width = round(rng.uniform(20, 110), 1)
        height = round(rng.uniform(30, 250), 1)
        fragility = rng.choices(FRAGILITY, weights=(4, 4, 2))[0]
        step = 0.25 if fragility == "fragile" else 0.5
        found = max(MIN_FORCE, math.ceil(true_min_force(mass, width, mu_est, material, rng) / step) * step)
        start = max(MIN_FORCE, round(physics_required(mass, mu_est) / step) * step)
        rows.append({
            "trial_id": f"t{i + 1:04d}", "material": material, "mass_g": mass, "width_mm": width, "height_mm": height,
            "friction_coefficient": mu_est, "fragility": fragility, "min_holding_force_n": round(found, 2),
            "tests_needed": 1 + int(abs(found - start) / step + 0.5),
        })
    return rows


def write_csv(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)


def read_csv(path: Path) -> list[dict]:
    with path.open(newline="") as f:
        out = []
        for r in csv.DictReader(f):
            for k in ("mass_g", "width_mm", "height_mm", "friction_coefficient", "min_holding_force_n"):
                r[k] = float(r[k])
            r["tests_needed"] = int(r["tests_needed"])
            out.append(r)
        return out


if __name__ == "__main__":  # python mlsim/dataset.py  -> regenerates mlsim/data/grasp_trials.csv
    p = Path(__file__).parent / "data" / "grasp_trials.csv"
    write_csv(generate(), p)
    print("wrote", p)
