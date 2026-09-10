"""Synthetic bounded query benchmark; prints timings and no customer payloads."""
from time import perf_counter

def run(size: int = 10_000, samples: int = 30) -> dict:
    rows = [{"bcn": f"{i:06d}", "name": f"Customer {i}", "status": "Open" if i % 5 else "Closed", "ownerId": f"sales-{i % 20}"} for i in range(size)]
    interactions = [{"bcn": f"{i % size:06d}", "actor": f"sales-{i % 20}"} for i in range(size * 5)]
    followups = [{"bcn": f"{i % size:06d}", "status": "Open" if i % 2 else "Completed"} for i in range(size * 5)]
    audit = [{"bcn": f"{i % size:06d}", "action": "Assignment"} for i in range(size * 5)]
    queries = {
        "search": lambda: [row for row in rows if "42" in row["name"]][:25],
        "my_customers": lambda: [row for row in rows if row["ownerId"] == "sales-7" and row["status"] == "Open"][:25],
        "workload": lambda: sum(1 for item in followups if item["status"] == "Open" and item["bcn"].endswith("7")),
        "report": lambda: sum(1 for row in rows if row["status"] == "Open"),
        "audit": lambda: [item for item in audit if item["bcn"].endswith("7")][:25],
    }
    timings = {name: [] for name in queries}
    for _ in range(samples):
        for name, query in queries.items():
            started = perf_counter(); query(); timings[name].append((perf_counter() - started) * 1000)
    percentile = lambda values, p: round(sorted(values)[max(0, int(len(values) * p) - 1)], 3)
    return {"customers": size, "interactions": len(interactions), "followups": len(followups), "audit": len(audit), "samples": samples, "queries": {name: {"p50_ms": percentile(values, .5), "p95_ms": percentile(values, .95)} for name, values in timings.items()}}

if __name__ == "__main__": print(run())
