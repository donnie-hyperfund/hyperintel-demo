---
name: component-extraction
description: Use when deciding whether to extract a React component inline (same file) or into a separate file. Covers when and how to split rendering logic.
user-invocable: false
---

# Component Extraction Rules

## Extract inline (same file) when:

- The component has **no hooks** and **no complex logic** — its purpose is purely rendering
- It cleans up the parent by removing a complex ternary, conditional block, or deeply nested JSX
- It is **only used in that file**

These are small, presentational helper components that exist to keep the main component readable.

```tsx
// Good: rendering-only, no hooks, cleans up the parent
function UploadedFileItem({ file, onRemove }: { file: File; onRemove: () => void }) {
    return (
        <div className="flex items-center gap-3">
            <FileText className="size-4" />
            <p className="truncate text-sm">{file.name}</p>
            <button onClick={onRemove}><X className="size-3.5" /></button>
        </div>
    );
}

function NewResourceDropdown() {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="soft">New resource</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                <DropdownMenuItem asChild><Link href="/companies/new">New company</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/stakeholders/new">New stakeholder</Link></DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
```

## Extract to a separate file when:

- The component has **its own hooks**, state management, or non-trivial logic
- The component is **used across multiple files**
- The component is **complex enough** to warrant its own tests or documentation
- Multiple instances of the same component pattern exist — deduplicate into a shared file

## Do NOT extract when:

- The JSX is simple and inline is more readable than an indirection
- Extracting would create a file with a single trivial component
- The "component" is really just a few lines of conditional JSX
