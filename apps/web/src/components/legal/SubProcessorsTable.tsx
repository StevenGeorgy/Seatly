import { SUB_PROCESSORS } from "@/lib/legal/subProcessors";

export function SubProcessorsTable() {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/40">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-border/40 bg-white/[0.03] text-xs uppercase tracking-wider text-text-muted">
          <tr>
            <th className="px-4 py-3 font-semibold">Sub-Processor</th>
            <th className="px-4 py-3 font-semibold">Service Provided</th>
            <th className="px-4 py-3 font-semibold">Primary Region</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30 text-text-secondary">
          {SUB_PROCESSORS.map((sp) => (
            <tr key={sp.name} className="align-top">
              <td className="px-4 py-3 font-medium text-white">{sp.name}</td>
              <td className="px-4 py-3">{sp.service}</td>
              <td className="px-4 py-3 whitespace-nowrap">{sp.region}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
