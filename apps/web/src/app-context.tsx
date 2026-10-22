import { createContext, useContext } from "react";
import type { Project, TaskStatus, Task } from "./types";
import type { DialogRequest } from "./ui";
import type { SessionSummary } from "./sessions";

export type AppContextValue = {
  tasks: Task[];
  sessions: SessionSummary[];
  projects: Project[];
  project: string;
  setProject: (id: string) => void;
  reloadProjects: () => void;
  reloadTasks: () => void;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  openDialog: (request: DialogRequest) => void;
  openPalette: () => void;
  newTask: (status?: TaskStatus) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
};

export const AppContext = createContext<AppContextValue>(null as never);

export const useApp = () => useContext(AppContext);
