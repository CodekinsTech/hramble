import fs from "node:fs/promises"
import path from "node:path"

export interface NotebookEditInput {
	filePath: string
	/** 0-based index of the target cell. */
	cellNumber: number
	newSource: string
	cellType?: "code" | "markdown"
	editMode?: "replace" | "insert" | "delete"
}

interface NotebookCell {
	cell_type: string
	source: string[]
	metadata?: Record<string, unknown>
	outputs?: unknown[]
	execution_count?: number | null
	id?: string
}

interface Notebook {
	cells: NotebookCell[]
	[key: string]: unknown
}

/** Split a string into nbformat-style source lines (newline kept on each line). */
function toSourceLines(text: string): string[] {
	if (text === "") return []
	const parts = text.split("\n")
	return parts.map((line, i) => (i < parts.length - 1 ? `${line}\n` : line))
}

/**
 * Edit a Jupyter notebook (.ipynb) cell: replace/insert/delete by index.
 * Mirrors Claude Code's NotebookEdit. Writes the notebook back with 1-space
 * indentation (nbformat convention) preserved as pretty JSON.
 */
export async function notebookEdit(input: NotebookEditInput, workingDir: string): Promise<string> {
	const resolved = path.resolve(workingDir, input.filePath)
	const raw = await fs.readFile(resolved, "utf-8")
	let nb: Notebook
	try {
		nb = JSON.parse(raw) as Notebook
	} catch {
		throw new Error(`${input.filePath} is not valid JSON.`)
	}
	if (!Array.isArray(nb.cells)) throw new Error(`${input.filePath} is not a Jupyter notebook (no cells array).`)

	const mode = input.editMode ?? "replace"
	const idx = input.cellNumber

	if (mode === "delete") {
		if (idx < 0 || idx >= nb.cells.length) throw new Error(`Cell ${idx} out of range (0-${nb.cells.length - 1}).`)
		nb.cells.splice(idx, 1)
		await fs.writeFile(resolved, JSON.stringify(nb, null, 1), "utf-8")
		return `Deleted cell ${idx} from ${input.filePath}`
	}

	if (mode === "insert") {
		const at = Math.max(0, Math.min(idx, nb.cells.length))
		const cellType = input.cellType ?? "code"
		const cell: NotebookCell = {
			cell_type: cellType,
			source: toSourceLines(input.newSource),
			metadata: {},
			...(cellType === "code" ? { outputs: [], execution_count: null } : {}),
		}
		nb.cells.splice(at, 0, cell)
		await fs.writeFile(resolved, JSON.stringify(nb, null, 1), "utf-8")
		return `Inserted ${cellType} cell at ${at} in ${input.filePath}`
	}

	// replace
	if (idx < 0 || idx >= nb.cells.length) throw new Error(`Cell ${idx} out of range (0-${nb.cells.length - 1}).`)
	const cell = nb.cells[idx]
	cell.source = toSourceLines(input.newSource)
	if (input.cellType && input.cellType !== cell.cell_type) {
		cell.cell_type = input.cellType
		if (input.cellType === "code") {
			cell.outputs = cell.outputs ?? []
			cell.execution_count = cell.execution_count ?? null
		} else {
			delete cell.outputs
			delete cell.execution_count
		}
	} else if (cell.cell_type === "code") {
		// Editing code invalidates prior outputs.
		cell.outputs = []
		cell.execution_count = null
	}
	await fs.writeFile(resolved, JSON.stringify(nb, null, 1), "utf-8")
	return `Replaced cell ${idx} in ${input.filePath}`
}

export const notebookEditToolDefinition = {
	name: "notebookedit",
	description:
		"Edit a Jupyter notebook (.ipynb) cell. editMode 'replace' (default) overwrites the cell's source, 'insert' adds a new cell before the given index, 'delete' removes it. Cells are 0-indexed. Read the notebook first.",
	input_schema: {
		type: "object" as const,
		properties: {
			filePath: { type: "string", description: "Path to the .ipynb file." },
			cellNumber: { type: "number", description: "0-based cell index." },
			newSource: { type: "string", description: "New cell source (ignored for delete)." },
			cellType: { type: "string", enum: ["code", "markdown"], description: "Cell type (for insert/replace)." },
			editMode: { type: "string", enum: ["replace", "insert", "delete"], description: "Default replace." },
		},
		required: ["filePath", "cellNumber", "newSource"],
	},
}
