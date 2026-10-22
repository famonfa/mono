import { createContext, useContext } from "react";
import type { TaskStatus, Task } from "./types";
import type { DialogRequest } from "./ui";
import type { SessionSummary } from "./sessions";

export type AppContextValue = {
  tasks: Task[];
  sessions: SessionSummary[];
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
