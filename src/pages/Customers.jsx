import { C, F } from "../lib/tokens";
import { customers } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import DataTable from "../components/DataTable";
import Btn from "../components/Btn";

export default function Customers() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader title="Customers" action={<Btn sz="sm">+ Add Customer</Btn>} />
      <DataTable
        cols={[
          { k: "name",    l: "Company",  r: v => <span style={{ fontWeight: 800, fontFamily: F.display, letterSpacing: "0.03em" }}>{v}</span> },
          { k: "address", l: "Address" },
          { k: "phone",   l: "Phone" },
          { k: "_a",      l: "",         r: () => <Btn sz="sm" v="ghost">View</Btn> },
        ]}
        rows={customers}
      />
    </div>
  );
}