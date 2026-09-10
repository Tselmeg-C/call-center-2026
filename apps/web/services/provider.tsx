"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createMockAdapter } from "./mock";
import { createHttpAdapter } from "./http";
import type { MockControls, Services, User } from "./types";

type Application = { services: Services; controls: MockControls; user: User | null };
const Context = createContext<Application | null>(null);

// The only adapter composition point. A mounted provider is one independent tab session.
export function ServiceProvider({ children }: { children: ReactNode }) {
  const [adapter] = useState(() => process.env.NEXT_PUBLIC_SERVICE_MODE === "http" ? createHttpAdapter() : createMockAdapter());
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => adapter.services.subscribeSession(setUser), [adapter]);
  return <Context.Provider value={{ ...adapter, user }}>{children}</Context.Provider>;
}

export function useServices() {
  const context = useContext(Context);
  if (!context) throw new Error("ServiceProvider is required.");
  return context;
}
