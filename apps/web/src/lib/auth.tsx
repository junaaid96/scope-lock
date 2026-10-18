import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.js";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  status: string;
  locale: string;
  createdAt: string;
}

export interface SessionOrg {
  id: string;
  name: string;
  plan: string;
  role: string | null;
}

export interface Session {
  user: SessionUser;
  organizations: SessionOrg[];
}

const AuthContext = createContext<{ session: Session | null; loading: boolean }>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<Session>("/auth/me"),
    retry: false,
  });
  return <AuthContext.Provider value={{ session: data ?? null, loading: isLoading }}>{children}</AuthContext.Provider>;
}

export function useSession(): { session: Session | null; loading: boolean } {
  return useContext(AuthContext);
}

export function useLogout(): () => Promise<void> {
  const client = useQueryClient();
  return async () => {
    await api.post("/auth/logout");
    client.clear();
    window.location.href = "/login";
  };
}
