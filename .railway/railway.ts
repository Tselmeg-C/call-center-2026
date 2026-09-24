import { defineRailway, image, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "ams" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "ams", sizeMB: 5000 });
  const frontend = service("frontend", {
    source: image("ghcr.io/tselmeg-c/call-center-2026-frontend:latest"),
    replicas: { "ams": 1 },
    env: { API_UPSTREAM: preserve() },
  });
  const api = service("api", {
    source: image("ghcr.io/tselmeg-c/call-center-2026-api:latest"),
    replicas: { "ams": 1 },
    env: { CALL_CENTER_STORAGE: preserve(), DATABASE_URL: preserve(), FRONTEND_ORIGIN: preserve(), OTEL_EXPORTER_OTLP_ENDPOINT: preserve(), OTEL_EXPORTER_OTLP_HEADERS: preserve(), OTEL_RESOURCE_ATTRIBUTES: preserve(), OTEL_SERVICE_NAME: preserve(), PORT: preserve(), WEB_CONCURRENCY: preserve() },
    deploy: { healthcheckPath: "/health/ready", healthcheckTimeout: 30 },
  });

  return project("call-center-2026", {
    resources: [frontend, Postgres, api, postgresVolume],
  });
});
