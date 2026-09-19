/**
 * dsh-endfield-boot — ENDFIELD boot loading screen only.
 *
 * Extracted from ymh0000123/dsh-theme-endfield (MIT) by keeping just the
 * launcher boot plate: a full-viewport black plate with an 8px signal-yellow
 * progress rail down the left edge, a meter group (tick + percentage +
 * status line) that rides the fill end, and the centred ENDFIELD wordmark.
 * Plays once per full page load, then the rail expands into a full-screen
 * yellow sweep and the plate fades out and removes itself.
 *
 * Nothing else from the theme is applied — no token overrides, no cream
 * paper, no contour sheet, no watermark, no settings page.
 *
 * @module dsh-endfield-boot/client
 */
window.__ModuleLoader__.load({
	id: "dsh-endfield-boot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/* The plate paints before the app's tokens resolve, so the two accent
		   variables it reads are declared here (DeepSeek blue). */
		const BOOT_CSS = `
      :root, body {
        --edge-accent: #4D6BFE;
        --edge-accent-rgb: 77, 107, 254;
      }
      /* Fixed plate above everything, including the shell overlay layer. It exists
         only while the boot animation plays and is removed afterwards. */
      [data-endfield-loader] {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        background: #101110;
        color: #f5f5f0;
        font-family: Arial, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
        font-feature-settings: "tnum" 1;
        overflow: hidden;
        pointer-events: none;
        opacity: 1;
      }
      [data-endfield-loader][data-endfield-loader-exit] {
        opacity: 0;
      }
      [data-endfield-loader-tex] {
        position: absolute;
        inset: 0;
        opacity: 0.55;
        background-image:
          repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.014) 0 1px, transparent 1px 4px),
          repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.010) 0 1px, transparent 1px 120px);
      }
      /* 10px rail: dim track full height, signal-yellow fill from the top down. */
      [data-endfield-loader-track] {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 10px;
        background: rgba(var(--edge-accent-rgb), 0.10);
      }
      [data-endfield-loader-fill] {
        position: absolute;
        left: 0;
        top: 0;
        width: 10px;
        height: 0%;
        background: var(--edge-accent);
      }
      /* Meter RIDES THE FILL END: top offset set per frame from the same eased
         progress value that drives the fill height (see step()). */
      [data-endfield-loader-meter] {
        position: absolute;
        left: 26px;
        top: 0;
        will-change: top;
      }
      [data-endfield-loader][data-endfield-loader-complete] [data-endfield-loader-meter] {
        position: fixed !important;
        left: 26px !important;
        top: auto !important;
        bottom: 64px !important;
      }
      /* Completion flourish: the rail widens into a full-screen yellow sweep,
         then the whole plate fades. Width/opacity are animated from JS. */
      [data-endfield-loader-wipe] {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 10px;
        background: var(--edge-accent);
        opacity: 0;
      }
      [data-endfield-loader-tick] {
        display: block;
        width: 4px;
        height: 15px;
        background: var(--edge-accent);
      }
      [data-endfield-loader-pct] {
        display: block;
        margin-top: 7px;
        color: var(--edge-accent);
        font-size: 39px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: -0.01em;
        font-variant-numeric: tabular-nums;
      }
      [data-endfield-loader-status] {
        display: block;
        margin-top: 12px;
        color: #666;
        font-size: 11px;
        font-weight: 400;
        letter-spacing: 0.02em;
      }
      /* Poster brand block — anchored by its right margin; --edge-word scales
         the whole block off the smaller viewport axis. */
      [data-endfield-loader] {
        --edge-word: clamp(26px, min(5.2vh, 4.8vw), 64px);
        --edge-gap: max(64px, 12%);
      }
      [data-endfield-loader-brand] {
        position: absolute;
        right: var(--edge-gap);
        top: 50%;
        transform: translateY(-50%);
      }
      [data-endfield-loader-kicker] {
        display: block;
        font-size: var(--edge-word);
      }
      [data-endfield-loader-kicker]::before {
        content: 'DEEPSEEK HARNESS';
        display: block;
        margin-bottom: 0.5em;
        color: #f5f5f0;
        font-size: max(9px, 0.155em);
        font-weight: 600;
        letter-spacing: 0.26em;
        white-space: nowrap;
        opacity: 0.95;
      }
      [data-endfield-loader-word] {
        display: block;
        margin-left: -0.055em;
        color: #f5f5f0;
        font-size: var(--edge-word);
        font-weight: 900;
        line-height: 0.80;
        letter-spacing: 0.01em;
        white-space: nowrap;
      }
      [data-endfield-loader-word1]::before { content: 'END'; }
      [data-endfield-loader-word2]::before { content: 'FIELD'; }
      [data-endfield-loader-detail] {
        display: block;
        position: relative;
        margin-top: 1.9em;
        font-size: var(--edge-word);
      }
      [data-endfield-loader-chev] {
        position: absolute;
        left: -0.26em;
        top: 0.02em;
        width: 0.12em;
        height: 0.24em;
      }
      [data-endfield-loader-chev]::before,
      [data-endfield-loader-chev]::after {
        content: '';
        position: absolute;
        left: 0;
        width: 0.10em;
        height: 0.10em;
        border-left: 0.028em solid var(--edge-accent);
        border-bottom: 0.028em solid var(--edge-accent);
        transform: rotate(-45deg);
      }
      [data-endfield-loader-chev]::before { top: 0; }
      [data-endfield-loader-chev]::after { top: 0.09em; }
      [data-endfield-loader-sub]::before {
        content: 'EDGE INTELLIGENCE THEME';
        display: block;
        color: #8a8d88;
        font-size: max(9px, 0.135em);
        font-weight: 500;
        letter-spacing: 0.12em;
        white-space: nowrap;
      }
      [data-endfield-loader-seq]::before {
        content: 'TERRA RESEARCH COMMISSION / BOOT SEQUENCE';
        display: block;
        margin-top: 0.4em;
        color: #6a6d64;
        font-size: max(8px, 0.125em);
        font-weight: 500;
        letter-spacing: 0.10em;
        white-space: nowrap;
      }
      [data-endfield-loader-squares] {
        display: grid;
        grid-template-columns: repeat(6, 0.115em);
        gap: 0.04em;
        margin-top: 0.30em;
      }
      [data-endfield-loader-squares] i {
        display: block;
        height: 0.05em;
        background: #2e302d;
      }
      [data-endfield-loader-squares] i[data-on] {
        background: var(--edge-accent);
      }
      [data-endfield-loader-tag]::before {
        content: 'OVER THE FRONTIER / INTO THE FRONT';
        display: block;
        margin-top: 1.05em;
        color: #f5f5f0;
        font-family: "Arial Narrow", Arial, sans-serif;
        font-size: max(10px, 0.34em);
        font-weight: 500;
        letter-spacing: 0.06em;
        white-space: nowrap;
      }
      [data-endfield-loader-tag] {
        display: block;
        font-size: var(--edge-word);
      }
      @media (max-width: 1100px) {
        [data-endfield-loader] { --edge-gap: max(48px, 9%); }
      }
      @media (max-width: 760px) {
        [data-endfield-loader] { --edge-gap: max(28px, 5%); }
      }
    `

		function insertCss(css) {
			// Dynamic Cordis runner provides the `styles` global; standalone bundle does not.
			if (typeof styles !== 'undefined' && styles && typeof styles.insert === 'function') {
				return styles.insert(css)
			}
			// Idempotency: never stack duplicate stylesheets if applied more than once.
			document.querySelectorAll('style[data-plugin="dsh-endfield-boot"]').forEach((old) => old.remove())
			const el = document.createElement('style')
			el.setAttribute('data-plugin', 'dsh-endfield-boot')
			el.textContent = css
			document.head.appendChild(el)
			return () => {
				if (el.parentNode) el.parentNode.removeChild(el)
			}
		}

		/* ---- boot loader state ---- */
		let loaderEl = null
		let loaderRaf = null
		let loaderTick = null
		let loaderFuse = null
		let loaderExitTimer = null
		let loaderKill = null
		let loaderDone = false
		let loaderPlateH = 0
		let loaderMeterH = 0

		/* Last-resort hard kill. Deliberately NOT cleared by clearLoaderTimers(): the
		   completion flourish calls that to stop the progress clocks, and this timer
		   has to outlive it so a stalled flourish can still never leave the app covered. */
		const clearLoaderTimers = () => {
			if (loaderRaf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(loaderRaf)
			loaderRaf = null
			if (loaderTick !== null && typeof clearInterval === 'function') clearInterval(loaderTick)
			loaderTick = null
			if (loaderFuse !== null && typeof clearTimeout === 'function') clearTimeout(loaderFuse)
			loaderFuse = null
			if (loaderExitTimer !== null && typeof clearTimeout === 'function') clearTimeout(loaderExitTimer)
			loaderExitTimer = null
		}

		/** Remove the plate and release every timer/handle it owns. Idempotent. */
		const destroyLoader = () => {
			clearLoaderTimers()
			if (loaderKill !== null && typeof clearTimeout === 'function') clearTimeout(loaderKill)
			loaderKill = null
			if (loaderEl && loaderEl.parentNode) loaderEl.parentNode.removeChild(loaderEl)
			loaderEl = null
			loaderPlateH = 0
			loaderMeterH = 0
		}

		/* One boot animation. Progress derives from elapsed WALL-CLOCK time, never
		   accumulated per frame, so it cannot drift. Two clocks drive the same
		   `step` deliberately: requestAnimationFrame for smooth vsync-aligned
		   updates, plus a coarse setInterval fallback that keeps advancing when rAF
		   is throttled or suspended. `loaderFuse` force-finishes even if both
		   clocks stop; `loaderKill` hard-removes the plate unconditionally, so the
		   app can never stay covered. */
		const runLoader = () => {
			if (loaderDone || loaderEl !== null) return
			if (typeof document === 'undefined') return
			// The plate is a <body> child. If the bundle is evaluated before the body
			// exists, defer to DOMContentLoaded instead of silently skipping.
			if (!document.body) {
				if (typeof document.addEventListener === 'function') {
					document.addEventListener('DOMContentLoaded', () => { runLoader() }, { once: true })
				}
				return
			}
			loaderDone = true

			const el = document.createElement('div')
			el.setAttribute('data-endfield-loader', '')
			el.setAttribute('translate', 'no')
			el.setAttribute('lang', 'en')
			el.setAttribute('aria-hidden', 'true')
			el.className = 'notranslate'
			el.innerHTML =
				'<div data-endfield-loader-tex></div>' +
				'<div data-endfield-loader-track></div>' +
				'<div data-endfield-loader-fill></div>' +
				'<div data-endfield-loader-meter>' +
				'<span data-endfield-loader-tick></span>' +
				'<span data-endfield-loader-pct></span>' +
				'<span data-endfield-loader-status></span>' +
				'</div>' +
				'<div data-endfield-loader-brand>' +
				'<span data-endfield-loader-kicker></span>' +
				'<span data-endfield-loader-word data-endfield-loader-word1></span>' +
				'<span data-endfield-loader-word data-endfield-loader-word2></span>' +
				'<span data-endfield-loader-detail>' +
				'<span data-endfield-loader-chev></span>' +
				'<span data-endfield-loader-sub></span>' +
				'<span data-endfield-loader-seq></span>' +
				'<span data-endfield-loader-squares>' +
				'<i data-on></i><i data-on></i><i data-on></i><i></i><i></i><i></i>' +
				'<i data-on></i><i data-on></i><i></i><i></i><i></i><i></i>' +
				'</span>' +
				'</span>' +
				'<span data-endfield-loader-tag></span>' +
				'</div>' +
				'<div data-endfield-loader-wipe></div>'
			document.body.appendChild(el)
			loaderEl = el

			const fill = el.querySelector('[data-endfield-loader-fill]')
			const meter = el.querySelector('[data-endfield-loader-meter]')
			const pct = el.querySelector('[data-endfield-loader-pct]')
			const status = el.querySelector('[data-endfield-loader-status]')
			const DURATION = 1750
			const start = (typeof performance !== 'undefined' && typeof performance.now === 'function')
				? performance.now()
				: Date.now()
			loaderPlateH = el.clientHeight || Math.ceil(el.getBoundingClientRect().height) || 0
			loaderMeterH = meter ? Math.ceil(meter.getBoundingClientRect().height) : 0
			const now = () => ((typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now())
			/* Completion sequence: WIPE_MS the rail expands into a full-screen yellow
			   sweep; EXIT_MS the whole plate fades. The fuse outlasts both. */
			const WIPE_MS = 520
			const EXIT_MS = 620
			let finished = false

			const finish = () => {
				if (finished) return
				finished = true
				// Stop the progress clocks but keep the plate: the flourish reuses these
				// handles, so clearLoaderTimers() must not tear the node down.
				clearLoaderTimers()
				if (!loaderEl) return
				const el = loaderEl
				const wipeEl = el.querySelector('[data-endfield-loader-wipe]')
				const hasRaf = typeof requestAnimationFrame === 'function'
				const hasTimeout = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
				// Someone who asked for less motion gets the plate gone, not a flourish.
				const reduceMotion = typeof window !== 'undefined'
					&& typeof window.matchMedia === 'function'
					&& window.matchMedia('(prefers-reduced-motion: reduce)').matches
				if (reduceMotion || (!hasRaf && !hasTimeout)) { destroyLoader(); return }
				el.setAttribute('data-endfield-loader-wiping', '')
				// JS owns opacity from here, so the stylesheet transition must not fight it.
				el.style.transition = 'none'
				const t0 = now()
				const plateW = el.clientWidth || 0
				const RAIL = 10
				let exitMarked = false
				const flourish = () => {
					if (!loaderEl) return
					const elapsed = now() - t0
					// phase 1 — sweep out of the rail across the full width
					const wt = Math.min(1, elapsed / WIPE_MS)
					const eased = 1 - Math.pow(1 - wt, 3)
					if (wipeEl) {
						wipeEl.style.opacity = '1'
						wipeEl.style.width = (RAIL + eased * Math.max(0, plateW - RAIL)).toFixed(1) + 'px'
					}
					// phase 2 — fade the whole plate, yellow included
					const fadeMs = elapsed - WIPE_MS
					if (fadeMs > 0) {
						if (!exitMarked) { exitMarked = true; el.setAttribute('data-endfield-loader-exit', '') }
						el.style.opacity = Math.max(0, 1 - fadeMs / EXIT_MS).toFixed(3)
					}
					if (elapsed >= WIPE_MS + EXIT_MS) { destroyLoader(); return }
					loaderRaf = hasRaf ? requestAnimationFrame(flourish) : null
				}
				// First frame synchronously so the sweep never starts from a blank frame.
				flourish()
				if (typeof setInterval === 'function') loaderTick = setInterval(flourish, 30)
				if (hasTimeout) loaderExitTimer = window.setTimeout(destroyLoader, WIPE_MS + EXIT_MS + 400)
			}

			const step = () => {
				if (finished || !loaderEl) return
				const t = Math.min(1, (now() - start) / DURATION)
				// easeOutCubic: quick climb, gentle settle onto 100%.
				const eased = 1 - Math.pow(1 - t, 3)
				const value = Math.round(eased * 100)
				const shown = value + '%'
				if (fill) fill.style.height = (eased * 100).toFixed(2) + '%'
				if (pct && pct.textContent !== shown) pct.textContent = shown
				if (status) {
					const label = value < 45 ? 'Connecting...' : (value < 99 ? 'Updating...' : 'Ready')
					if (status.textContent !== label) status.textContent = label
				}
				/* Meter follows the fill's leading edge, driven by the SAME eased value.
				   Positioned in px and clamped: the group is ~90px tall, so a raw
				   percentage would push it off the bottom near 100%. */
				if (meter) {
					const SAFE_BOTTOM = 64
					if (value >= 100) {
						meter.style.setProperty('top', 'auto', 'important')
						meter.style.setProperty('bottom', SAFE_BOTTOM + 'px', 'important')
					} else {
						meter.style.removeProperty('bottom')
						meter.style.removeProperty('top')
						const plateRect = el.getBoundingClientRect()
						loaderMeterH = Math.ceil(meter.getBoundingClientRect().height)
						const GAP = 10
						const raw = eased * (plateRect.height || loaderPlateH) + GAP
						const maxTop = Math.max(0, (plateRect.height || loaderPlateH) - loaderMeterH - SAFE_BOTTOM)
						meter.style.top = Math.min(raw, maxTop).toFixed(1) + 'px'
						const meterRect = meter.getBoundingClientRect()
						const allowedBottom = plateRect.bottom - SAFE_BOTTOM
						if (meterRect.bottom > allowedBottom) {
							const currentTop = parseFloat(meter.style.top) || 0
							meter.style.top = Math.max(0, currentTop - meterRect.bottom + allowedBottom).toFixed(1) + 'px'
						}
					}
				}
				if (t >= 1) {
					el.setAttribute('data-endfield-loader-complete', '')
					// Hold the completed frame for a beat so 100% is actually readable.
					if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
						if (loaderExitTimer === null) loaderExitTimer = window.setTimeout(finish, 220)
					} else finish()
					return
				}
				loaderRaf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(step) : null
			}
			// Paint the first frame synchronously: never flash at 0%/empty.
			step()
			// Clock 2: coarse fallback that survives rAF throttling.
			if (typeof setInterval === 'function') loaderTick = setInterval(step, 60)
			if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
				// Fuse: if both progress clocks stall, force the completion sequence.
				loaderFuse = window.setTimeout(() => { finished = false; finish() }, DURATION + 1600)
				// Hard kill: covers the flourish itself stalling (a suspended tab can
				// hold an animation indefinitely). Removes the node unconditionally.
				loaderKill = window.setTimeout(destroyLoader, DURATION + 1600 + WIPE_MS + EXIT_MS + 400)
			} else if (loaderRaf === null && loaderTick === null) {
				destroyLoader()
			}
		}

		function apply(ctx) {
			// Idempotency: the installed bundle can be applied more than once.
			if (typeof window !== 'undefined' && window.__dshEndfieldBootApplied) return
			if (typeof window !== 'undefined') window.__dshEndfieldBootApplied = true
			if (typeof document === 'undefined') return
			insertCss(BOOT_CSS)
			runLoader()
		}

		exports.name = "dsh-endfield-boot";
		exports.apply = apply;
		return module.exports;
	}
});
