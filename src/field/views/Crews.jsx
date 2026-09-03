import FieldScreen, { PlainTable, RefreshBtn, useAsync } from "../components/FieldScreen";
import { fetchFieldCrews } from "../lib/queries";

export default function Crews() {
  const { data: rows, loading, error, reload } = useAsync(fetchFieldCrews, []);
  return (
    <FieldScreen
      title="Crews"
      subtitle="Who's assigned where"
      right={<RefreshBtn onClick={reload} loading={loading} />}
    >
      {error ? (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "#3a1c1c", color: "#ef6b6b", fontSize: 13 }}>{error}</div>
      ) : (
        <PlainTable
          rows={rows || []}
          empty={loading ? "Loading…" : "No crew assigned to active jobs."}
          columns={[
            { key: "member", label: "Crew member" },
            { key: "role", label: "Role", render: (r) => r.role || "—" },
            { key: "job", label: "Job" },
          ]}
        />
      )}
    </FieldScreen>
  );
}
