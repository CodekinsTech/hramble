// Hramble notebook — edit Jupyter .ipynb cells. A .ipynb is JSON with a `cells`
// array; this replaces, inserts, or deletes a cell by index and writes it back.

import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import fs from "node:fs"

export default async () => ({
	tool: {
		notebook_edit: tool({
			description:
				"Edit a Jupyter notebook (.ipynb). Replace, insert, or delete a cell by index. Use for notebooks; use edit/write for normal source files.",
			args: {
				path: z.string().describe("Absolute path to the .ipynb file"),
				cell: z.number().int().describe("0-based cell index to act on"),
				mode: z
					.enum(["replace", "insert", "delete"])
					.describe("replace the cell, insert a new cell at this index, or delete it"),
				source: z
					.string()
					.optional()
					.describe("New cell content (required for replace/insert)"),
				cell_type: z
					.enum(["code", "markdown"])
					.optional()
					.describe("Cell type for replace/insert (default: code)"),
			},
			execute: async (args) => {
				let nb
				try {
					nb = JSON.parse(fs.readFileSync(args.path, "utf8"))
				} catch (e) {
					return `Could not read notebook: ${String(e)}`
				}
				if (!Array.isArray(nb.cells)) return "Not a valid notebook (no cells array)."
				const lines = (s) => s.split(/(?<=\n)/) // keep newlines, nbformat expects a string[]

				if (args.mode === "delete") {
					if (args.cell < 0 || args.cell >= nb.cells.length) return "Cell index out of range."
					nb.cells.splice(args.cell, 1)
				} else {
					if (args.source == null) return "source is required for replace/insert."
					const newCell = {
						cell_type: args.cell_type ?? "code",
						metadata: {},
						source: lines(args.source),
						...(args.cell_type === "markdown" ? {} : { outputs: [], execution_count: null }),
					}
					if (args.mode === "insert") {
						nb.cells.splice(Math.max(0, Math.min(args.cell, nb.cells.length)), 0, newCell)
					} else {
						if (args.cell < 0 || args.cell >= nb.cells.length) return "Cell index out of range."
						newCell.metadata = nb.cells[args.cell].metadata ?? {}
						nb.cells[args.cell] = newCell
					}
				}
				try {
					fs.writeFileSync(args.path, `${JSON.stringify(nb, null, 1)}\n`)
				} catch (e) {
					return `Could not write notebook: ${String(e)}`
				}
				return `Notebook updated (${args.mode} at cell ${args.cell}). ${nb.cells.length} cells now.`
			},
		}),
	},
})
