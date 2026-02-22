/**
 * XTermConnector - Minimal bridge between xterm.js and TerminalText renderer
 *
 * This connector provides a simple interface to sync XTerm.js buffer content,
 * cursor position, and selection to the CRT renderer. It does NOT handle
 * keyboard input, shell emulation, or any application-specific logic.
 *
 * Users are expected to handle their own XTerm input/output logic.
 *
 * Color extraction: syncBuffer() now reads per-cell foreground/background
 * colors and text attributes (bold, italic, underline, etc.) from the xterm
 * buffer using the IBufferCell API, and passes them to TerminalText via
 * setCells() so that the canvas renders actual terminal colors.
 */

import type { IBufferCell, Terminal } from "@xterm/xterm";
import type { TerminalCell, TerminalText } from "./TerminalText";

/**
 * Standard ANSI 256-color palette.
 * Indices 0-7: standard colors
 * Indices 8-15: bright colors
 * Indices 16-231: 6x6x6 color cube
 * Indices 232-255: grayscale ramp
 */
const ANSI_256_PALETTE: string[] = (() => {
	const palette: string[] = new Array(256);

	// Standard colors (0-7)
	palette[0] = "#000000"; // Black
	palette[1] = "#aa0000"; // Red
	palette[2] = "#00aa00"; // Green
	palette[3] = "#aa5500"; // Yellow
	palette[4] = "#0000aa"; // Blue
	palette[5] = "#aa00aa"; // Magenta
	palette[6] = "#00aaaa"; // Cyan
	palette[7] = "#aaaaaa"; // White

	// Bright colors (8-15)
	palette[8] = "#555555"; // Bright Black
	palette[9] = "#ff5555"; // Bright Red
	palette[10] = "#55ff55"; // Bright Green
	palette[11] = "#ffff55"; // Bright Yellow
	palette[12] = "#5555ff"; // Bright Blue
	palette[13] = "#ff55ff"; // Bright Magenta
	palette[14] = "#55ffff"; // Bright Cyan
	palette[15] = "#ffffff"; // Bright White

	// 6x6x6 color cube (16-231)
	const cubeValues = [0, 95, 135, 175, 215, 255];
	for (let r = 0; r < 6; r++) {
		for (let g = 0; g < 6; g++) {
			for (let b = 0; b < 6; b++) {
				const index = 16 + r * 36 + g * 6 + b;
				const rr = cubeValues[r].toString(16).padStart(2, "0");
				const gg = cubeValues[g].toString(16).padStart(2, "0");
				const bb = cubeValues[b].toString(16).padStart(2, "0");
				palette[index] = `#${rr}${gg}${bb}`;
			}
		}
	}

	// Grayscale ramp (232-255)
	for (let i = 0; i < 24; i++) {
		const v = (8 + i * 10).toString(16).padStart(2, "0");
		palette[232 + i] = `#${v}${v}${v}`;
	}

	return palette;
})();

/**
 * Convert an xterm IBufferCell's color to a CSS color string.
 * Handles default, palette (256-color), and RGB (truecolor) modes.
 *
 * @param cell - The xterm buffer cell
 * @param isForeground - true for foreground color, false for background
 * @returns CSS color string or null for default
 */
function cellColorToCSS(
	cell: IBufferCell,
	isForeground: boolean,
): string | null {
	if (isForeground) {
		if (cell.isFgDefault()) {
			return null; // default foreground
		}
		if (cell.isFgRGB()) {
			// True color (24-bit): color number encodes R, G, B
			const color = cell.getFgColor();
			const r = (color >>> 16) & 0xff;
			const g = (color >>> 8) & 0xff;
			const b = color & 0xff;
			return `rgb(${r},${g},${b})`;
		}
		if (cell.isFgPalette()) {
			const index = cell.getFgColor();
			if (index >= 0 && index < 256) {
				return ANSI_256_PALETTE[index];
			}
		}
		// Fallback: try palette lookup from raw color number
		const color = cell.getFgColor();
		if (color >= 0 && color < 256) {
			return ANSI_256_PALETTE[color];
		}
		return null;
	}

	// Background
	if (cell.isBgDefault()) {
		return null; // default background
	}
	if (cell.isBgRGB()) {
		const color = cell.getBgColor();
		const r = (color >>> 16) & 0xff;
		const g = (color >>> 8) & 0xff;
		const b = color & 0xff;
		return `rgb(${r},${g},${b})`;
	}
	if (cell.isBgPalette()) {
		const index = cell.getBgColor();
		if (index >= 0 && index < 256) {
			return ANSI_256_PALETTE[index];
		}
	}
	const color = cell.getBgColor();
	if (color >= 0 && color < 256) {
		return ANSI_256_PALETTE[color];
	}
	return null;
}

export class XTermConnector {
	private xterm: Terminal;
	private terminalText: TerminalText;
	private disposed = false;

	// Selection state
	private isSelecting = false;
	private selectionStart: { col: number; row: number } | null = null;

	// Reusable IBufferCell to avoid allocation per cell
	private cellBuffer: IBufferCell | undefined;

	constructor(xterm: Terminal, terminalText: TerminalText) {
		this.xterm = xterm;
		this.terminalText = terminalText;

		// Initial sync
		this.syncBuffer();
		this.syncCursor();

		// Listen for scroll events to update the renderer
		this.xterm.onScroll(() => {
			if (!this.disposed) {
				this.syncBuffer();
				this.syncCursor();
			}
		});

		// Listen for cursor changes
		this.xterm.onCursorMove(() => {
			if (!this.disposed) {
				this.syncCursor();
			}
		});

		// Listen for data/writes to update display
		this.xterm.onWriteParsed(() => {
			if (!this.disposed) {
				this.syncBuffer();
				this.syncCursor();
			}
		});
	}

	/**
	 * Sync the XTerm buffer content to the TerminalText renderer.
	 * Extracts per-cell character, foreground color, background color,
	 * and text attributes (bold, italic, underline, etc.).
	 */
	syncBuffer(): void {
		const buffer = this.xterm.buffer.active;
		const totalLines = buffer.length;
		const viewportStart = buffer.viewportY;
		const rows = this.xterm.rows;
		const cols = this.xterm.cols;

		// Update selection viewport offset
		this.terminalText.updateSelectionViewport(viewportStart);

		const cellGrid: TerminalCell[][] = [];

		for (let i = 0; i < rows; i++) {
			const lineIndex = viewportStart + i;
			const cellRow: TerminalCell[] = [];

			if (lineIndex < totalLines) {
				const line = buffer.getLine(lineIndex);
				if (line) {
					for (let j = 0; j < cols; j++) {
						// Reuse buffer cell to reduce allocations
						this.cellBuffer = line.getCell(j, this.cellBuffer) ?? undefined;
						if (this.cellBuffer) {
							const cell = this.cellBuffer;
							const char = cell.getChars();
							const width = cell.getWidth();

							// Skip continuation cells of wide characters
							if (width === 0 && char === "") {
								cellRow.push({
									char: "",
									fg: null,
									bg: null,
								});
								continue;
							}

							const fg = cellColorToCSS(cell, true);
							const bg = cellColorToCSS(cell, false);

							// Extract text attributes from cell
							// xterm.js stores attributes in a bitmask:
							// Bit 0: bold
							// Bit 1: underline
							// Bit 2: blink
							// Bit 3: inverse
							// Bit 4: invisible
							// Bit 5: italic (some implementations)
							// Bit 6: dim
							// Bit 7: strikethrough (some implementations)
							//
							// However, the public API doesn't expose the raw bitmask.
							// We use isBold(), isItalic(), etc. if available,
							// or fall back to checking the attrs bitfield.
							const isBold = cell.isBold();
							const isDim = cell.isDim();
							const isItalic = cell.isItalic();
							const isUnderline = cell.isUnderline();
							const isInverse = cell.isInverse();
							const isStrikethrough = cell.isStrikethrough();

							cellRow.push({
								char: char,
								fg: fg,
								bg: bg,
								bold: isBold ? true : undefined,
								dim: isDim ? true : undefined,
								italic: isItalic ? true : undefined,
								underline: isUnderline ? true : undefined,
								inverse: isInverse ? true : undefined,
								strikethrough: isStrikethrough ? true : undefined,
							});
						} else {
							cellRow.push({
								char: "",
								fg: null,
								bg: null,
							});
						}
					}
				}
			}

			// Pad short rows
			while (cellRow.length < cols) {
				cellRow.push({ char: "", fg: null, bg: null });
			}

			cellGrid.push(cellRow);
		}

		this.terminalText.setCells(cellGrid);
	}

	/**
	 * Sync the cursor position to the TerminalText renderer
	 */
	syncCursor(): void {
		const buffer = this.xterm.buffer.active;

		// Check if viewport is scrolled away from cursor
		const cursorActualLine = buffer.baseY + buffer.cursorY;
		const viewportStart = buffer.viewportY;
		const viewportEnd = viewportStart + this.xterm.rows - 1;
		const isScrolledAway =
			cursorActualLine < viewportStart || cursorActualLine > viewportEnd;

		if (isScrolledAway) {
			this.terminalText.setCursorVisible(false);
		} else {
			this.terminalText.setCursorVisible(true);
			const cursorCol = buffer.cursorX;
			const cursorRowInViewport = cursorActualLine - viewportStart;
			this.terminalText.setCursorPosition(cursorCol, cursorRowInViewport);
		}
	}

	/**
	 * Manually trigger a full sync (buffer + cursor)
	 * Call this after writing to XTerm or on resize
	 */
	sync(): void {
		this.syncBuffer();
		this.syncCursor();
	}

	/**
	 * Setup mouse selection handlers on a container element
	 * This enables text selection in the terminal
	 */
	setupMouseSelection(container: HTMLElement): void {
		container.addEventListener("mousedown", (event: MouseEvent) => {
			if (event.button !== 0) return;

			const rect = container.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			const gridPos = this.terminalText.pixelToGrid(x, y);

			const viewportY = this.xterm.buffer.active.viewportY;
			const absPos = { col: gridPos.col, row: gridPos.row + viewportY };

			this.isSelecting = true;
			this.selectionStart = absPos;

			this.terminalText.setSelection(absPos, absPos, viewportY);

			event.preventDefault();
		});

		container.addEventListener("mousemove", (event: MouseEvent) => {
			if (!this.isSelecting || !this.selectionStart) return;

			const rect = container.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			const gridPos = this.terminalText.pixelToGrid(x, y);

			const viewportY = this.xterm.buffer.active.viewportY;
			const absPos = { col: gridPos.col, row: gridPos.row + viewportY };

			this.terminalText.setSelection(this.selectionStart, absPos, viewportY);
		});

		container.addEventListener("mouseup", (event: MouseEvent) => {
			if (event.button !== 0) return;

			if (this.isSelecting && this.selectionStart) {
				const rect = container.getBoundingClientRect();
				const x = event.clientX - rect.left;
				const y = event.clientY - rect.top;
				const gridPos = this.terminalText.pixelToGrid(x, y);

				const viewportY = this.xterm.buffer.active.viewportY;
				const absPos = { col: gridPos.col, row: gridPos.row + viewportY };

				// Single click (no drag) - clear selection
				if (
					absPos.col === this.selectionStart.col &&
					absPos.row === this.selectionStart.row
				) {
					this.terminalText.clearSelection();
				} else {
					this.terminalText.setSelection(
						this.selectionStart,
						absPos,
						viewportY,
					);
					this.copySelectionToClipboard();
				}
			}

			this.isSelecting = false;
			this.selectionStart = null;

			this.xterm.focus();
		});

		container.addEventListener("mouseleave", () => {
			this.isSelecting = false;
			this.selectionStart = null;
		});

		// Wheel scrolling
		container.addEventListener(
			"wheel",
			(event: WheelEvent) => {
				const lines =
					Math.sign(event.deltaY) *
					Math.max(1, Math.floor(Math.abs(event.deltaY) / 50));
				this.xterm.scrollLines(lines);
				this.sync();
				event.preventDefault();
			},
			{ passive: false },
		);

		// Right-click: copy if text is selected, paste if not
		container.addEventListener("contextmenu", (event: MouseEvent) => {
			event.preventDefault();

			const selection = this.terminalText.getSelection();
			const hasSelection =
				selection.start &&
				selection.end &&
				(selection.start.row !== selection.end.row ||
					selection.start.col !== selection.end.col);

			if (hasSelection) {
				// Copy selected text to clipboard
				this.copySelectionToClipboard();
			} else {
				// Paste from clipboard
				navigator.clipboard
					.readText()
					.then((text) => {
						if (text) {
							this.xterm.paste(text);
						}
						this.xterm.focus();
					})
					.catch((err) => {
						console.warn("Could not read from clipboard:", err);
						this.xterm.focus();
					});
			}
		});
	}

	/**
	 * Copy current selection to clipboard
	 */
	private copySelectionToClipboard(): void {
		const selection = this.terminalText.getSelection();
		if (!selection.start || !selection.end) return;

		const buffer = this.xterm.buffer.active;

		let startRow = selection.start.row;
		let startCol = selection.start.col;
		let endRow = selection.end.row;
		let endCol = selection.end.col;

		// Normalize selection
		if (startRow > endRow || (startRow === endRow && startCol > endCol)) {
			[startRow, endRow] = [endRow, startRow];
			[startCol, endCol] = [endCol, startCol];
		}

		const selectedLines: string[] = [];
		for (let row = startRow; row <= endRow; row++) {
			const line = buffer.getLine(row);
			if (!line) {
				selectedLines.push("");
				continue;
			}

			const lineText = line.translateToString(true);
			let lineStart = 0;
			let lineEnd = lineText.length;

			if (row === startRow) lineStart = startCol;
			if (row === endRow) lineEnd = endCol + 1;

			selectedLines.push(lineText.slice(lineStart, lineEnd));
		}

		const selectedText = selectedLines.join("\n");

		if (selectedText) {
			navigator.clipboard.writeText(selectedText).catch((err) => {
				console.warn("Could not copy to clipboard:", err);
			});
		}
	}

	/**
	 * Get the underlying XTerm instance
	 */
	getXTerm(): Terminal {
		return this.xterm;
	}

	/**
	 * Get the TerminalText renderer
	 */
	getTerminalText(): TerminalText {
		return this.terminalText;
	}

	/**
	 * Dispose of resources and event listeners
	 */
	dispose(): void {
		this.disposed = true;
	}
}
