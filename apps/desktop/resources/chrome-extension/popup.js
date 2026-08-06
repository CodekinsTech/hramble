const dot = document.getElementById("dot")
const status = document.getElementById("status")

fetch("http://127.0.0.1:47821/status")
	.then((r) => (r.ok ? r.json() : Promise.reject()))
	.then(() => {
		dot.className = "dot on"
		status.textContent = "Connected to Hramble"
	})
	.catch(() => {
		dot.className = "dot off"
		status.textContent = "Hramble not running"
	})
