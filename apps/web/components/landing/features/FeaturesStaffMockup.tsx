"use client";

export function FeaturesStaffMockup() {
  return (
    <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
      <p className="mb-md text-xs font-medium text-text-muted-on-dark">
        Today&apos;s shift
      </p>
      <div className="space-y-sm">
        {[
          { name: "Sarah K.", role: "Host", status: "Clocked in" },
          { name: "Mike T.", role: "Server", status: "Clocked in" },
          { name: "Alex L.", role: "Server", status: "—" },
        ].map((staff) => (
          <div
            key={staff.name}
            className="flex items-center justify-between text-sm"
          >
            <div>
              <span className="text-text-on-dark">{staff.name}</span>
              <span className="ml-sm text-text-muted-on-dark">{staff.role}</span>
            </div>
            <span
              className={
                staff.status === "Clocked in"
                  ? "text-success text-xs"
                  : "text-text-muted-on-dark text-xs"
              }
            >
              {staff.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
