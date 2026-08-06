import { BarcodeFormat, BarcodeScanner } from "@capacitor-mlkit/barcode-scanning"

export type QrScanOutcome =
	| { status: "scanned"; value: string }
	| { status: "cancelled" }
	| { status: "unsupported" }
	| { status: "permission-denied" }
	| { status: "error"; message: string }

/**
 * Opens the ready-to-use native scanner UI (BarcodeScanner.scan) and returns
 * the raw value of the first QR code found. On Android this uses the Google
 * Play Services barcode-scanning module (no camera permission needed for
 * `scan()` itself, but the module must be installed first — most devices
 * with Play Services already have it). iOS needs camera permission.
 */
export async function scanQrCode(): Promise<QrScanOutcome> {
	try {
		const { supported } = await BarcodeScanner.isSupported()
		if (!supported) return { status: "unsupported" }

		const { camera } = await BarcodeScanner.checkPermissions()
		if (camera !== "granted" && camera !== "limited") {
			const { camera: requested } = await BarcodeScanner.requestPermissions()
			if (requested !== "granted" && requested !== "limited") {
				return { status: "permission-denied" }
			}
		}

		// Android-only: the actual scanning UI is backed by a dynamically
		// delivered Google Play Services module — install it on first use if
		// it isn't already present, otherwise `scan()` fails immediately.
		try {
			const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
			if (!available) {
				await BarcodeScanner.installGoogleBarcodeScannerModule()
			}
		} catch {
			// isGoogleBarcodeScannerModuleAvailable is Android-only — ignore on other platforms.
		}

		const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] })
		const value = barcodes[0]?.rawValue ?? barcodes[0]?.displayValue
		if (!value) return { status: "cancelled" }
		return { status: "scanned", value }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		// The plugin rejects with an error when the user backs out of the
		// scanner UI — treat that the same as an ordinary cancel.
		if (/cancel/i.test(message)) return { status: "cancelled" }
		return { status: "error", message }
	}
}
