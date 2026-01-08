export function DashboardHeader() {
  return (
    <header className="h-14 border-b border-border flex items-center px-6 gap-4">
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold">
          HYPER<span className="text-primary">INTEL</span>
          <sup className="text-[10px] align-super">™</sup>
        </span>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <div className="text-sm text-muted-foreground">Project Name / Chat Name</div>
      </div>
    </header>
  )
}

