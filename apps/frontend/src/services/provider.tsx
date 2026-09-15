import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createHttpServices } from "./http";
import { createMockServices } from "./mock";
import type { Services, User } from "./types";

/** The one composition point: VITE_SERVICE_MODE=http selects the real backend adapter, anything
 *  else (including unset, the local dev default) uses the in-memory mock. */
function createServices(): Services {
  return import.meta.env["VITE_SERVICE_MODE"] === "http" ? createHttpServices() : createMockServices();
}

const ServicesContext = createContext<Services | null>(null);

export function ServiceProvider({ children }: { children: ReactNode }) {
  const [services] = useState(createServices);
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("ServiceProvider is required.");
  return services;
}

export function useSession(): { user: User | null; loading: boolean } {
  const services = useServices();
  const [state, setState] = useState<{ user: User | null; loading: boolean }>({ user: null, loading: true });
  useEffect(() => services.subscribeSession((user) => setState({ user, loading: false })), [services]);
  return state;
}
