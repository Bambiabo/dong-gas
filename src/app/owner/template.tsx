import type { ReactNode } from 'react';
import './owner.css';

export default function OwnerTemplate({ children }: { children: ReactNode }) {
  return <div className="owner-workspace">{children}</div>;
}
