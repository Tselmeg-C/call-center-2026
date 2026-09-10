"""Synthetic query benchmark; prints timings and no customer payloads."""
from time import perf_counter

def run(size: int = 10_000, samples: int = 30) -> dict[str, float | int]:
    rows = [{"bcn": f"{i:06d}", "name": f"Customer {i}", "status": "Open" if i % 5 else "Closed", "ownerId": f"sales-{i % 20}"} for i in range(size)]
    timings = []
    for _ in range(samples):
        started = perf_counter(); [row for row in rows if row["status"] == "Open" and "42" in row["name"]][:25]; timings.append((perf_counter() - started) * 1000)
    ordered = sorted(timings)
    return {"rows": size, "samples": samples, "p50_ms": round(ordered[len(ordered) // 2], 3), "p95_ms": round(ordered[max(0, int(samples * .95) - 1)], 3)}

if __name__ == "__main__": print(run())
