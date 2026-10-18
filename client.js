// dsh-experimental-sansheng — browser half.
//
// Registers one conversation-header action that appears only while the
// 三省六部 mode is active for this Team. The panel is a read-only view over two
// session projections published by the Host:
//   - `sansheng`  : the board folded from the Lead session event log
//   - `agentTeam` : the shared Team roster and task board
//
// There is no RPC and no file access here: the browser renders exactly what the
// Host projected, so the board can never diverge from the session log.
window.__ModuleLoader__.load({
	id: "dsh-experimental-sansheng",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let react = require("react");

		/** Browser services required by the header action. */
		const inject = ["slots"];

		const TAG = "dsh-experimental-sansheng";

		const CSS = [
			".dss-root{display:inline-flex;align-items:center}",
			".dss-trigger{min-height:28px;background:0 0;border:0;border-radius:6px;color:var(--dsw-alias-label-tertiary);cursor:pointer;align-items:center;gap:6px;padding:3px 7px;font-size:12px;display:inline-flex}",
			".dss-trigger:hover,.dss-trigger:focus-visible{color:var(--dsw-alias-label-primary)}",
			".dss-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-caption);flex:none}",
			".dss-dot-pass{background:var(--dsw-alias-state-success-primary,#3fb950)}",
			".dss-dot-open{background:var(--dsw-alias-state-business-primary,#4c8dff)}",
			".dss-count{color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}",
			".dss-panel{position:fixed;top:52px;right:16px;z-index:120;box-sizing:border-box;width:min(460px,calc(100vw - 32px));max-height:min(72vh,720px);overflow-y:auto;border-radius:12px;padding:14px 16px 18px;background:var(--dsw-specific-menu,#1f2024);color:var(--dsw-alias-label-primary,#eee);border:1px solid var(--dsw-alias-border-l2,#3a3b40);box-shadow:0 12px 40px rgba(0,0,0,.45);font-size:12px;line-height:1.55}",
			".dss-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}",
			".dss-title{display:flex;align-items:baseline;gap:8px;flex:1;min-width:0}",
			".dss-title strong{font-size:14px;font-weight:600}",
			".dss-pinyin{color:var(--dsw-alias-label-tertiary);font-size:11px}",
			".dss-close{background:0 0;border:0;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:18px;line-height:1;padding:2px 4px;border-radius:6px}",
			".dss-close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2,#2a2b30)}",
			".dss-section{margin-top:12px}",
			".dss-section > h4{margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);text-transform:uppercase}",
			".dss-row{display:flex;align-items:center;gap:8px;min-width:0}",
			".dss-row + .dss-row{margin-top:4px}",
			".dss-muted{color:var(--dsw-alias-label-tertiary)}",
			".dss-mono{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px}",
			".dss-badge{display:inline-flex;align-items:center;border-radius:999px;padding:0 8px;height:18px;font-size:11px;flex:none}",
			".dss-badge-pass{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fb950) 18%,transparent);color:var(--dsw-alias-state-success-primary,#3fb950)}",
			".dss-badge-reject{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f85149) 18%,transparent);color:var(--dsw-alias-state-error-primary,#f85149)}",
			".dss-badge-pending{background:var(--dsw-alias-bg-layer-2,#2a2b30);color:var(--dsw-alias-label-tertiary)}",
			".dss-card{border:.5px solid var(--dsw-alias-border-l2,#3a3b40);background:var(--dsw-alias-bg-layer-2,#242529);border-radius:9px;padding:9px 11px}",
			".dss-warn{color:var(--dsw-alias-state-error-primary,#f85149)}",
			".dss-defects{margin:4px 0 0;padding-left:16px;color:var(--dsw-alias-state-error-primary,#f85149)}",
			".dss-defects li{margin:2px 0}",
			".dss-empty{color:var(--dsw-alias-label-tertiary);margin:2px 0}",
			".dss-footer{margin-top:14px;color:var(--dsw-alias-label-caption);font-size:11px}",
		].join("");

		function h(type, props) {
			const children = Array.prototype.slice.call(arguments, 2);
			return react.createElement.apply(react, [type, props].concat(children));
		}

		function ensureStyle() {
			if (typeof document === "undefined") return function () {};
			const existing = document.querySelector('style[data-plugin-css="' + TAG + '"]');
			if (existing !== null) return function () {};
			const style = document.createElement("style");
			style.dataset.plugin = TAG;
			style.dataset.pluginCss = TAG;
			style.textContent = CSS;
			document.head.appendChild(style);
			return function () {
				style.remove();
			};
		}

		function latestGate(board, kind) {
			for (let index = board.gates.length - 1; index >= 0; index -= 1) {
				if (board.gates[index].kind === kind) return board.gates[index];
			}
			return null;
		}

		function gateBadge(gate) {
			if (gate === null) return h("span", { className: "dss-badge dss-badge-pending" }, "待审");
			return h(
				"span",
				{ className: "dss-badge dss-badge-" + (gate.verdict === "pass" ? "pass" : "reject") },
				gate.verdict === "pass" ? "通过" : "封驳",
			);
		}

		function GateSection(props) {
			const { title, gate } = props;
			return h(
				"div",
				{ className: "dss-section" },
				h("h4", null, title),
				h(
					"div",
					{ className: "dss-row" },
					gateBadge(gate),
					gate === null
						? h("span", { className: "dss-muted" }, "尚未提交")
						: h("span", { className: "dss-muted" }, "由 " + gate.reviewer + " 判定"),
				),
				gate !== null && gate.defects.length > 0
					? h("ul", { className: "dss-defects" }, gate.defects.map((defect, index) => h("li", { key: index }, defect)))
					: null,
			);
		}

		function Appointments(props) {
			const { board } = props;
			if (board.appointments.length === 0) {
				return h("p", { className: "dss-empty" }, "尚未任命六部。");
			}
			return h(
				"div",
				{ className: "dss-card" },
				board.appointments.map((appointment) =>
					h(
						"div",
						{ className: "dss-row", key: appointment.id },
						h("strong", null, appointment.department),
						h("span", { className: "dss-muted" }, "← " + appointment.member),
						appointment.writeScopes.length > 0
							? h("span", { className: "dss-muted dss-mono" }, appointment.writeScopes.join(", "))
							: null,
					),
				),
			);
		}

		function EvidenceSection(props) {
			const { board, team } = props;
			const tasks = team !== undefined && team !== null && Array.isArray(team.tasks) ? team.tasks : [];
			const completed = tasks.filter((task) => task.status === "completed");
			const covered = new Set(board.evidence.map((record) => record.taskId).filter((taskId) => typeof taskId === "string"));
			const missing = completed.filter((task) => covered.has(task.id) === false);
			return h(
				"div",
				{ className: "dss-section" },
				h("h4", null, "证据 · 刑部"),
				h(
					"div",
					{ className: "dss-row" },
					h("span", null, "已登记 " + board.evidence.length + " 条"),
					h("span", { className: "dss-muted" }, "· 已完成任务 " + completed.length),
					missing.length > 0
						? h("span", { className: "dss-warn" }, "· 缺证据 " + missing.length)
						: null,
				),
				missing.length > 0
					? h("ul", { className: "dss-defects" }, missing.map((task) => h("li", { key: task.id }, "任务 " + task.id + " 已完成但没有证据")))
					: null,
			);
		}

		function ClosureSection(props) {
			const { board } = props;
			const closure = board.closure;
			if (closure === null) {
				return h(
					"div",
					{ className: "dss-section" },
					h("h4", null, "结案 · 回奏"),
					h("p", { className: "dss-empty" }, "尚未结案。"),
				);
			}
			return h(
				"div",
				{ className: "dss-section" },
				h("h4", null, "结案 · 回奏"),
				h(
					"div",
					{ className: "dss-card" },
					h("div", { className: "dss-row" }, h("strong", null, "结论")),
					h("ul", null, closure.conclusions.map((item, index) => h("li", { key: "c" + index }, item))),
					h("div", { className: "dss-row" }, h("strong", null, "交付物")),
					h("ul", null, closure.deliverables.map((item, index) => h("li", { key: "d" + index }, item))),
					h("div", { className: "dss-row" }, h("strong", null, "残留未知")),
					h("ul", null, closure.unknowns.map((item, index) => h("li", { key: "u" + index }, item))),
					closure.next.length > 0 ? h("div", { className: "dss-row" }, h("strong", null, "下一步"), h("span", { className: "dss-muted" }, closure.next.join(" · "))) : null,
					h("div", { className: "dss-footer" }, "由 " + closure.closedBy + " 结案"),
				),
			);
		}

		function Warnings(props) {
			const { board, team } = props;
			const plan = latestGate(board, "plan");
			const tasks = team !== undefined && team !== null && Array.isArray(team.tasks) ? team.tasks : [];
			const completed = tasks.filter((task) => task.status === "completed");
			const covered = new Set(board.evidence.map((record) => record.taskId).filter((taskId) => typeof taskId === "string"));
			const missing = completed.filter((task) => covered.has(task.id) === false);
			const warnings = [];
			if (board.abandoned !== null && board.abandoned !== undefined) warnings.push("本案件已放弃：" + board.abandoned.reason + "。重新进入模式可继续。");
			if (board.edict === null) warnings.push("尚未拟旨：先调用 sansheng_edict。");
			if (board.edict !== null && plan === null) warnings.push("计划门未审：需要门下省用 sansheng_gate {kind:\"plan\"} 审议。");
			if (plan !== null && plan.verdict === "reject") warnings.push("计划被门封驳：按缺陷清单整改后重新提交审议。");
			if (board.edict !== null && board.edict.tier !== "small" && plan !== null && plan.verdict === "pass" && board.appointments.length === 0 && board.closure === null) {
				warnings.push("计划已过门但尚未派工：尚书省应任命六部后再开工。");
			}
			if (missing.length > 0) warnings.push("已完成任务缺少证据：" + missing.map((task) => task.id).join(", ") + "。");
			const result = latestGate(board, "result");
			if (result !== null && result.verdict === "pass" && Array.isArray(result.reviews)) {
				const reviewed = new Set(result.reviews.map((review) => review.taskId));
				const unreviewed = completed.filter((task) => reviewed.has(task.id) === false);
				if (unreviewed.length > 0) warnings.push("成果门通过但任务缺少逐任务 verdict（旧记录）：" + unreviewed.map((task) => task.id).join(", ") + "。");
			}
			if (warnings.length === 0) return null;
			return h(
				"div",
				{ className: "dss-section" },
				h("h4", null, "红区"),
				h("ul", { className: "dss-defects" }, warnings.map((warning, index) => h("li", { key: "w" + index }, warning))),
			);
		}

		function SanshengPanel(props) {
			const { board, team, onClose } = props;
			const edict = board.edict;
			return h(
				"div",
				{ className: "dss-panel", role: "dialog", "aria-label": "三省六部看板" },
				h(
					"div",
					{ className: "dss-head" },
					h(
						"div",
						{ className: "dss-title" },
						h("strong", null, "三省六部"),
						h("span", { className: "dss-pinyin" }, "Sān Shěng Liù Bù"),
						h("span", { className: "dss-muted" }, "rev " + String(board.revision ?? 0)),
					),
					h("button", { className: "dss-close", onClick: onClose, title: "关闭" }, "×"),
				),
				edict === null
					? h("p", { className: "dss-empty" }, "尚未拟旨。")
					: h(
						"div",
						{ className: "dss-card" },
						h("div", { className: "dss-row" }, h("strong", null, edict.goal)),
						h(
							"div",
							{ className: "dss-row" },
							h("span", { className: "dss-badge dss-badge-pending" }, edict.tier),
							h("span", { className: "dss-muted" }, "编制上限 " + edict.rosterCap + " 人"),
							edict.departments.length > 0
								? h("span", { className: "dss-muted" }, "· " + edict.departments.join(" / "))
								: null,
						),
					),
				h(GateSection, { title: "计划门 · 门下省", gate: latestGate(board, "plan") }),
				h(Appointments, { board }),
				h(EvidenceSection, { board, team }),
				h(GateSection, { title: "成果门 · 门下省", gate: latestGate(board, "result") }),
				h(ClosureSection, { board }),
				h(Warnings, { board, team }),
				h("div", { className: "dss-footer" }, "状态来自当前会话事件日志；没有共享任务文件。"),
			);
		}

		function sanshengAction(props) {
			const { sessionId, useSession, useSessions } = props;
			const [open, setOpen] = react.useState(false);
			const parentId = useSession((snapshot) => snapshot?.subagent?.address?.parentSessionId);
			const leadSessionId = parentId ?? sessionId;
			const board = useSessions(
				(state) => state?.projectionsBySession?.[leadSessionId]?.values?.sansheng,
			);
			const team = useSessions(
				(state) => state?.projectionsBySession?.[leadSessionId]?.values?.agentTeam,
			);

			react.useEffect(() => {
				if (open === false) return undefined;
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [open]);

			if (board === undefined || board === null || board.active !== true) return null;

			const plan = latestGate(board, "plan");
			const result = latestGate(board, "result");
			const tone = result !== null && result.verdict === "pass"
				? "dss-dot-pass"
				: plan !== null && plan.verdict === "pass"
					? "dss-dot-open"
					: "";

			return h(
				"div",
				{ className: "dss-root" },
				h(
					"button",
					{
						className: "dss-trigger",
						onClick: () => setOpen((value) => value === false),
						title: "三省六部看板",
					},
					h("span", { className: "dss-dot " + tone }),
					h("span", null, "三省六部"),
					h("span", { className: "dss-count" }, String(board.appointments.length)),
				),
				open ? h(SanshengPanel, { board, team, onClose: () => setOpen(false) }) : null,
			);
		}

		function apply(ctx) {
			ctx.effect(() => ensureStyle(), "sansheng: board style");
			ctx.slots.inject("conversation.session.header.actions", () =>
				ctx.slots.register(
					{
						name: "conversation.session.header.actions",
						id: "sansheng",
						order: -10,
					},
					sanshengAction,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
