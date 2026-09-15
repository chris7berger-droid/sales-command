import { useAsync } from "../components/FieldScreen";
import {
  FieldOfficeScreen,
  FieldOfficeTable,
  FieldOfficeError,
  QuietBadge,
  recordCount,
} from "../components/FieldOfficeList";
import { fetchFieldCrews } from "../lib/queries";

export default function Crews() {
  const { data: rows, loading, error, reload } = useAsync(fetchFieldCrews, []);
  const loaded = Array.isArray(rows);
  return (
    <FieldOfficeScreen
      title="Crews"
      subtitle="Who's assigned where"
      count={!error && loaded ? recordCount(rows.length, "assignment", "assignments") : null}
      loading={loading}
      onRefresh={reload}
    >
      {error ? (
        <FieldOfficeError>{error}</FieldOfficeError>
      ) : (
        <FieldOfficeTable
          loaded={loaded}
          loading={loading}
          rows={rows || []}
          empty="No crew assigned to active jobs."
          columns={[
            {
              key: "member",
              label: "Crew member",
              width: "minmax(160px, 1.3fr)",
              render: (r) => <span className="field-office-member">{r.member}</span>,
            },
            {
              key: "role",
              label: "Role",
              width: "minmax(110px, 0.8fr)",
              render: (r) => <QuietBadge>{r.role}</QuietBadge>,
            },
            {
              key: "job",
              label: "Job",
              width: "minmax(180px, 1.6fr)",
            },
          ]}
        />
      )}
    </FieldOfficeScreen>
  );
}
