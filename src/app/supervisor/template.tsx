import type { ReactNode } from 'react';
import './supervisor.css';

export default function SupervisorTemplate({ children }: { children: ReactNode }) {
  return <div className="supervisor-workspace">{children}</div>;
}
