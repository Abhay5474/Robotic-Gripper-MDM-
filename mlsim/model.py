"""A small neural network (MLP, one tanh hidden layer) trained with Adam, in pure Python.

Inputs: log(mass), log(estimated mu), width, height, fragility (one-hot), material (one-hot).
Target: log(minimum holding force). Working in logs turns the physics (force ~ mass / mu) into
something close to linear, so a small network learns it quickly; the material and width effects
are what it has to discover from the data.
"""
from __future__ import annotations

import math
import random

from dataset import FRAGILITY, MATERIALS

MATS = list(MATERIALS)


def features(r: dict) -> list[float]:
    x = [math.log(r["mass_g"] / 1000), math.log(r["friction_coefficient"]), r["width_mm"] / 100, r["height_mm"] / 200]
    x += [1.0 if r["fragility"] == f else 0.0 for f in FRAGILITY]
    x += [1.0 if r["material"] == m else 0.0 for m in MATS]
    return x


class MLP:
    def __init__(self, n_in: int, hidden: int = 16, seed: int = 7):
        rng = random.Random(seed)
        s = 1 / math.sqrt(n_in)
        self.W1 = [[rng.uniform(-s, s) for _ in range(n_in)] for _ in range(hidden)]
        self.b1 = [0.0] * hidden
        self.W2 = [rng.uniform(-1 / math.sqrt(hidden), 1 / math.sqrt(hidden)) for _ in range(hidden)]
        self.b2 = 0.0
        self.mu: list[float] = [0.0] * n_in
        self.sd: list[float] = [1.0] * n_in
        self.ty = (0.0, 1.0)  # target mean / sd
        self._m = self._zeros(); self._v = self._zeros(); self._t = 0

    def _zeros(self):
        return [[[0.0] * len(r) for r in self.W1], [0.0] * len(self.b1), [0.0] * len(self.W2), [0.0]]

    def fit_scaler(self, X: list[list[float]], y: list[float]) -> None:
        n = len(X)
        self.mu = [sum(x[k] for x in X) / n for k in range(len(X[0]))]
        self.sd = [max(1e-6, math.sqrt(sum((x[k] - self.mu[k]) ** 2 for x in X) / n)) for k in range(len(X[0]))]
        my = sum(y) / n
        self.ty = (my, max(1e-6, math.sqrt(sum((v - my) ** 2 for v in y) / n)))

    def _norm(self, x):
        return [(v - m) / s for v, m, s in zip(x, self.mu, self.sd)]

    def predict_log(self, x: list[float]) -> float:
        x = self._norm(x)
        out = self.b2
        for j, w in enumerate(self.W1):
            out += self.W2[j] * math.tanh(self.b1[j] + sum(wk * xk for wk, xk in zip(w, x)))
        return out * self.ty[1] + self.ty[0]

    def predict(self, r: dict) -> float:
        return math.exp(self.predict_log(features(r)))

    def train_epoch(self, X, y, lr=0.01, batch=32, rng: random.Random | None = None) -> float:
        """One pass over (X, y) with mini-batch Adam. Returns the mean squared error (scaled target)."""
        idx = list(range(len(X)))
        (rng or random).shuffle(idx)
        Xn = [self._norm(x) for x in X]
        yn = [(v - self.ty[0]) / self.ty[1] for v in y]
        H, total = len(self.W1), 0.0
        for s in range(0, len(idx), batch):
            bi = idx[s:s + batch]
            gW1 = [[0.0] * len(self.W1[0]) for _ in range(H)]; gb1 = [0.0] * H; gW2 = [0.0] * H; gb2 = 0.0
            for i in bi:
                x = Xn[i]
                a = [math.tanh(self.b1[j] + sum(wk * xk for wk, xk in zip(self.W1[j], x))) for j in range(H)]
                err = self.b2 + sum(w * aj for w, aj in zip(self.W2, a)) - yn[i]
                total += err * err
                dy = 2 * err / len(bi)
                gb2 += dy
                for j in range(H):
                    gW2[j] += dy * a[j]
                    dz = dy * self.W2[j] * (1 - a[j] * a[j])
                    gb1[j] += dz
                    row = gW1[j]
                    for k, xk in enumerate(x):
                        row[k] += dz * xk
            self._adam([gW1, gb1, gW2, [gb2]], lr)
        return total / len(X)

    def _adam(self, grads, lr, b1=0.9, b2=0.999, eps=1e-8):
        self._t += 1
        c1, c2 = 1 - b1 ** self._t, 1 - b2 ** self._t

        def upd(p, g, m, v):
            for k in range(len(g)):
                m[k] = b1 * m[k] + (1 - b1) * g[k]
                v[k] = b2 * v[k] + (1 - b2) * g[k] * g[k]
                p[k] -= lr * (m[k] / c1) / (math.sqrt(v[k] / c2) + eps)

        for j in range(len(self.W1)):
            upd(self.W1[j], grads[0][j], self._m[0][j], self._v[0][j])
        upd(self.b1, grads[1], self._m[1], self._v[1])
        upd(self.W2, grads[2], self._m[2], self._v[2])
        box = [self.b2]
        upd(box, grads[3], self._m[3], self._v[3])
        self.b2 = box[0]

    def mse(self, X, y) -> float:
        return sum(((self.predict_log(x) - self.ty[0]) / self.ty[1] - (v - self.ty[0]) / self.ty[1]) ** 2 for x, v in zip(X, y)) / len(X)
