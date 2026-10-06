export function MockTag({ on }: { on?: boolean }) {
  return on ? <span className="tag" title="Contract address not configured; showing mock values" style={{ marginLeft: 6, color: "var(--brass)", borderColor: "var(--brass-dk)" }}>mock</span> : null;
}
export function NotDeployed({ name }: { name: string }) {
  return <div className="notice warn small">{name} is not deployed on this chain yet (no address in the deployment address book yet). Values show as “—”.</div>;
}
