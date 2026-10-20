// dsh-experimental-sansheng — browser half.
//
// Registers one conversation-header action that appears only while the
// 三省六部 mode is active for this Team. The panel is a read-only board over two
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
		const inject = ["slots", "sidebarRight", "sidebarRightTabs"];

		const TAG = "dsh-experimental-sansheng";

		const CSS = [
			".dss-root{display:inline-flex;align-items:center}",
			".dss-trigger{min-height:28px;background:0 0;border:0;border-radius:6px;color:var(--dsw-alias-label-tertiary);cursor:pointer;align-items:center;gap:6px;padding:3px 7px;font-size:var(--dsh-content-font-size,14px);display:inline-flex}",
			".dss-trigger:hover,.dss-trigger:focus-visible{color:var(--dsw-alias-label-primary)}",
			".dss-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-caption);flex:none}",
			".dss-dot-pass{background:var(--dsw-alias-state-success-primary,#3fb950)}",
			".dss-dot-open{background:var(--dsw-alias-state-business-primary,#4c8dff)}",
			".dss-dot-warn{background:var(--dsw-alias-state-error-primary,#f85149)}",
			".dss-count{color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}",
			".dss-right{box-sizing:border-box;height:100%;overflow:auto;padding:4px 10px 20px;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size,14px)}",
			".dss-right .dss-card,.dss-right .dss-task,.dss-right .dss-evidence,.dss-right .dss-history-item,.dss-right .dss-history-title,.dss-right .dss-history-head,.dss-right .dss-event-text,.dss-right .dss-task-meta,.dss-right .dss-list,.dss-right .dss-defects,.dss-right .dss-muted,.dss-right .dss-empty,.dss-right .dss-warn,.dss-right .dss-badge,.dss-right .dss-mono{font-size:calc(var(--dsh-content-font-size,14px) - 2px)}",
			".dss-right .dss-section h4,.dss-right .dss-right-head strong,.dss-right .dss-page-tabs .dss-tab{font-size:var(--dsh-content-font-size,14px)}",
			".dss-page{font-size:var(--dsh-content-font-size,14px)}",
			".dss-page *{font-size:inherit!important}",
			".dss-right-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;padding:4px 2px 8px}",
			".dss-right-head strong{font-size:13px}",
			".dss-page{box-sizing:border-box;width:100%;height:100%;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:24px 28px 48px}",
			".dss-page-inner{max-width:1120px;margin:0 auto;display:flex;flex-direction:column;gap:16px}",
			".dss-page-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-bottom:14px;border-bottom:1px solid var(--dsw-alias-border-l1,#2f3033)}",
			".dss-page-title{margin:0;font-size:20px;font-weight:600}",
			".dss-page-sub{color:var(--dsw-alias-label-secondary);font-size:12px}",
			".dss-page-select{margin-left:auto;max-width:320px;background:var(--dsw-alias-bg-layer-2,#242529);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2,#3a3b40);border-radius:7px;padding:5px 8px;font-size:12px}",
			".dss-page-tabs{display:flex;gap:2px;padding:4px 0 0;border-bottom:1px solid var(--dsw-alias-border-l2,#3a3b40);flex-wrap:wrap}",
			".dss-page .dss-panel{position:static;width:100%;max-height:none;box-shadow:none;border:0;background:0 0}",
			".dss-panel{position:fixed;top:48px;right:20px;z-index:120;box-sizing:border-box;width:min(1000px,calc(100vw - 40px));max-height:min(84vh,900px);overflow:hidden;border-radius:14px;background:var(--dsw-alias-bg-layer-1,#1f2024);color:var(--dsw-alias-label-primary,#eee);border:1px solid var(--dsw-alias-border-l2,#3a3b40);box-shadow:0 20px 60px rgba(0,0,0,.5);font-size:12px;line-height:1.55;display:flex;flex-direction:column}",
			".dss-head{display:flex;align-items:center;gap:10px;padding:13px 16px 9px;border-bottom:1px solid var(--dsw-alias-border-l2,#3a3b40)}",
			".dss-title{display:flex;align-items:baseline;gap:8px;flex:1;min-width:0;flex-wrap:wrap}",
			".dss-title strong{font-size:15px;font-weight:600}",
			".dss-pinyin{color:var(--dsw-alias-label-tertiary);font-size:11px}",
			".dss-chip{display:inline-flex;align-items:center;gap:4px;height:20px;border-radius:999px;padding:0 8px;font-size:11px;background:var(--dsw-alias-bg-layer-2,#2a2b30);color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
			".dss-chip b{font-weight:600;color:var(--dsw-alias-label-primary)}",
			".dss-close{background:0 0;border:0;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:20px;line-height:1;padding:2px 6px;border-radius:6px}",
			".dss-close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2,#2a2b30)}",
			".dss-tabs{display:flex;gap:2px;padding:6px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#3a3b40);flex-wrap:wrap}",
			".dss-tab{background:0 0;border:0;border-bottom:2px solid transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:6px 10px;font-size:12px}",
			".dss-tab:hover{color:var(--dsw-alias-label-primary)}",
			".dss-tab-on{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-state-business-primary,#4c8dff)}",
			".dss-body{overflow-y:auto;padding:12px 16px 16px}",
			".dss-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px}",
			".dss-section{margin:0 0 12px}",
			".dss-section > h4{margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);text-transform:uppercase}",
			".dss-row{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}",
			".dss-row + .dss-row{margin-top:4px}",
			".dss-col{display:flex;flex-direction:column;gap:2px}",
			".dss-muted{color:var(--dsw-alias-label-tertiary)}",
			".dss-mono{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px}",
			".dss-badge{display:inline-flex;align-items:center;border-radius:999px;padding:0 8px;height:18px;font-size:11px;flex:none;background:var(--dsw-alias-bg-layer-2,#2a2b30);color:var(--dsw-alias-label-tertiary)}",
			".dss-badge-pass{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3fb950) 18%,transparent);color:var(--dsw-alias-state-success-primary,#3fb950)}",
			".dss-badge-reject{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f85149) 18%,transparent);color:var(--dsw-alias-state-error-primary,#f85149)}",
			".dss-badge-pending{background:var(--dsw-alias-bg-layer-2,#2a2b30);color:var(--dsw-alias-label-tertiary)}",
			".dss-badge-info{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4c8dff) 18%,transparent);color:var(--dsw-alias-state-business-primary,#4c8dff)}",
			".dss-card{border:.5px solid var(--dsw-alias-border-l2,#3a3b40);background:var(--dsw-alias-bg-layer-2,#242529);border-radius:10px;padding:10px 12px;min-width:0}",
			".dss-warn{color:var(--dsw-alias-state-error-primary,#f85149)}",
			".dss-defects{margin:4px 0 0;padding-left:16px;color:var(--dsw-alias-state-error-primary,#f85149)}",
			".dss-defects li{margin:2px 0}",
			".dss-list{margin:4px 0 0;padding-left:16px}",
			".dss-list li{margin:2px 0}",
			".dss-empty{color:var(--dsw-alias-label-tertiary);margin:2px 0}",
			".dss-footer{padding:8px 16px 12px;border-top:1px solid var(--dsw-alias-border-l2,#3a3b40);color:var(--dsw-alias-label-caption);font-size:11px}",
			".dss-stats{display:flex;gap:6px;flex-wrap:wrap}",
			".dss-kanban{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;align-items:start}",
			".dss-col-head{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}",
			".dss-task{border:.5px solid var(--dsw-alias-border-l2,#3a3b40);background:var(--dsw-alias-bg-layer-2,#242529);border-radius:9px;padding:8px 9px;margin-bottom:8px}",
			".dss-task strong{font-weight:600;font-size:12px;word-break:break-word}",
			".dss-task-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}",
			".dss-evidence{border-left:2px solid var(--dsw-alias-state-business-primary,#4c8dff);padding:2px 0 2px 8px;margin:0 0 8px}",
			".dss-timeline{position:relative;margin:0;padding:0 0 0 14px;list-style:none}",
			".dss-timeline:before{content:'';position:absolute;left:3px;top:3px;bottom:3px;width:1px;background:var(--dsw-alias-border-l2,#3a3b40)}",
			".dss-event{position:relative;padding:0 0 10px}",
			".dss-event:before{content:'';position:absolute;left:-14px;top:5px;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-caption)}",
			".dss-event-pass:before{background:var(--dsw-alias-state-success-primary,#3fb950)}",
			".dss-event-reject:before,.dss-event-denied:before{background:var(--dsw-alias-state-error-primary,#f85149)}",
			".dss-event-info:before{background:var(--dsw-alias-state-business-primary,#4c8dff)}",
			".dss-event-time{color:var(--dsw-alias-label-caption);font-size:10px;margin-right:6px;font-variant-numeric:tabular-nums}",
			".dss-event-text{font-size:12px;word-break:break-word}",
			".dss-link{background:0 0;border:.5px solid var(--dsw-alias-border-l2,#3a3b40);border-radius:6px;color:var(--dsw-alias-state-business-primary,#4c8dff);cursor:pointer;font-size:11px;padding:2px 7px;white-space:nowrap}",
			".dss-link:hover{background:var(--dsw-alias-bg-layer-2,#2a2b30)}",
			".dss-link:disabled{color:var(--dsw-alias-label-caption);cursor:default;border-color:var(--dsw-alias-border-l1,#2f3033)}",
			".dss-error{margin:0 0 8px;padding:7px 9px;border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f85149) 14%,transparent);color:var(--dsw-alias-state-error-primary,#f85149);font-size:11px}",
			".dss-member{display:flex;align-items:center;gap:8px;border:.5px solid var(--dsw-alias-border-l2,#3a3b40);background:var(--dsw-alias-bg-layer-2,#242529);border-radius:8px;padding:8px 10px;margin-bottom:7px}",
			".dss-member-main{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}",
			".dss-history-filters{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}",
			".dss-history-chip{background:0 0;border:.5px solid var(--dsw-alias-border-l2,#3a3b40);border-radius:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;padding:2px 8px}",
			".dss-history-chip[aria-pressed=true]{border-color:var(--dsw-alias-state-business-primary,#4c8dff);color:var(--dsw-alias-state-business-primary,#4c8dff)}",
			".dss-history-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0}",
			".dss-history-item{border-bottom:.5px solid var(--dsw-alias-border-l1,#2f3033);padding:6px 0}",
			".dss-history-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}",
			".dss-history-title{font-size:12px;font-weight:500;overflow-wrap:anywhere}",
			".dss-history-item details{margin-top:2px}",
			".dss-history-item summary{color:var(--dsw-alias-label-caption);cursor:pointer;font-size:11px;list-style:none}",
			".dss-history-item summary::-webkit-details-marker{display:none}",
			".dss-history-item summary:hover{color:var(--dsw-alias-label-secondary)}",
			".dss-history-pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--dsw-alias-bg-layer-2,#242529);border-radius:6px;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono,monospace);font-size:11px;line-height:1.5;margin:4px 0 0;max-height:260px;overflow:auto;padding:7px 8px}",
			".dss-kv{display:grid;grid-template-columns:max-content 1fr;gap:2px 10px;margin-top:4px}",
			".dss-kv dt{color:var(--dsw-alias-label-tertiary);font-size:11px}",
			".dss-kv dd{margin:0;word-break:break-word}",
			"@media(max-width:820px){.dss-panel{right:10px;width:calc(100vw - 20px);top:44px}.dss-kanban{grid-template-columns:repeat(2,minmax(0,1fr))}}",
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
			const gates = Array.isArray(board.gates) ? board.gates : [];
			for (let index = gates.length - 1; index >= 0; index -= 1) {
				if (gates[index].kind === kind) return gates[index];
			}
			return null;
		}

		function teamTasks(team) {
			return team !== undefined && team !== null && Array.isArray(team.tasks) ? team.tasks : [];
		}

		function coveredIds(board) {
			const evidence = Array.isArray(board.evidence) ? board.evidence : [];
			return new Set(evidence.filter((record) => typeof record.taskId === "string").map((record) => record.taskId));
		}

		function reviewedIds(gate) {
			const reviews = gate !== null && Array.isArray(gate.reviews) ? gate.reviews : [];
			return new Set(reviews.map((review) => review.taskId));
		}

		function gateBadge(gate) {
			if (gate === null) return h("span", { className: "dss-badge dss-badge-pending" }, "待审");
			const conditional = gate.verdict === "pass" && Array.isArray(gate.conditions) && gate.conditions.length > 0;
			return h(
				"span",
				{ className: "dss-badge dss-badge-" + (gate.verdict === "pass" ? "pass" : "reject") },
				conditional ? "有条件通过" : gate.verdict === "pass" ? "通过" : "封驳",
			);
		}

		function latestAudit(board, scope) {
			const audits = Array.isArray(board.audits) ? board.audits : [];
			for (let index = audits.length - 1; index >= 0; index -= 1) {
				if (audits[index].scope === scope) return audits[index];
			}
			return null;
		}

		function needsHuman(board) {
			const edict = board.edict;
			if (edict === null) return false;
			return edict.tier === "large" || edict.riskLevel === "high" || edict.riskLevel === "irreversible";
		}

		function fmtTime(value) {
			if (typeof value !== "number" || value <= 0) return "";
			try {
				return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
			} catch {
				return "";
			}
		}

		function opLabel(op) {
			return ({
				mode: "模式",
				edict: "拟旨",
				appoint: "任命",
				gate: "审议",
				evidence: "取证",
				close: "结案",
				approval: "御批",
				audit: "审计",
				denied: "拒绝",
			})[op] ?? op;
		}

		function eventTone(entry) {
			if (entry.op === "denied") return "dss-event-denied";
			if (entry.op === "gate") return entry.verdict === "pass" ? "dss-event-pass" : "dss-event-reject";
			if (entry.op === "approval") return entry.decision === "approve" ? "dss-event-pass" : "dss-event-reject";
			if (entry.op === "audit") return entry.verdict === "pass" ? "dss-event-pass" : "dss-event-reject";
			if (entry.op === "mode" || entry.op === "edict" || entry.op === "appoint") return "dss-event-info";
			return "";
		}

		function eventText(entry) {
			switch (entry.op) {
				case "mode":
					if (entry.newCase === true) return "开新宗卷 #" + String(entry.caseId ?? "?");
					return entry.abandoned !== null && entry.abandoned !== undefined
						? "离开模式并放弃：" + entry.abandoned
						: entry.active === true ? "进入模式" : "离开模式";
				case "edict":
					return "拟旨：第 " + String(entry.revisionNo ?? "?") + " 版 · " + String(entry.goal ?? "");
				case "appoint":
					return "任命 " + String(entry.member ?? "?") + " → " + String(entry.department ?? "?");
				case "gate":
					return (entry.kind === "plan" ? "计划门 " : "成果门 ") + (entry.verdict === "pass" ? "通过" : "封驳")
						+ (entry.checked ? " · 核对 " + entry.checked + " 项" : "");
				case "evidence":
					return "取证 " + String(entry.taskId ?? "?") + (entry.workstreamId ? " · " + entry.workstreamId : "") + " · " + String(entry.command ?? "");
				case "close":
					return "结案：" + String((entry.conclusions ?? [])[0] ?? "");
				case "approval":
					return "御批" + (entry.decision === "approve" ? "准奏" : "封驳") + (entry.reason ? "：" + entry.reason : "");
				case "audit":
					return "独立审计 " + (entry.scope === "plan" ? "计划" : "成果") + " " + (entry.verdict === "pass" ? "通过" : "驳回")
						+ (entry.conditionsMet ? " · 条件 " + entry.conditionsMet + " 项" : "");
				case "denied":
					return "拒绝 " + String(entry.code ?? "") + "：" + String(entry.message ?? "").replace(/^[A-Z_]+:\s*/, "");
				default:
					return String(entry.op ?? "");
			}
		}

		function latestApprovalLabel(board, plan) {
			const approvals = Array.isArray(board.approvals) ? board.approvals : [];
			const approval = approvals.length === 0 ? null : approvals[approvals.length - 1];
			if (approval !== null && plan !== null && approval.rev > plan.rev) {
				return approval.decision === "approve" ? "已准奏" : "已封驳";
			}
			if (board.edict !== null && needsHuman(board) && plan !== null && plan.verdict === "pass") return "待御批";
			return "—";
		}

		function GateSection(props) {
			const { title, gate, notRequired } = props;
			return h(
				"div",
				{ className: "dss-section" },
				h("h4", null, title),
				h(
					"div",
					{ className: "dss-row" },
					notRequired && gate === null ? h("span", { className: "dss-badge dss-badge-pending" }, "轻量不需要") : gateBadge(gate),
					notRequired && gate === null
						? h("span", { className: "dss-muted" }, "small 档只做独立成果复核")
						: gate === null
							? h("span", { className: "dss-muted" }, "尚未提交")
							: h("span", { className: "dss-muted" }, "由 " + gate.reviewer + " 判定"),
				),
				gate !== null && Array.isArray(gate.defects) && gate.defects.length > 0
					? h("ul", { className: "dss-defects" }, gate.defects.map((defect, index) => h("li", { key: index }, defect)))
					: null,
			);
		}

		const HISTORY_KINDS = {
			user: "消息",
			assistant: "回复",
			inbox: "来信",
			"tool-call": "调用",
			"tool-result": "结果",
		};

		function EdictCard(props) {
			const { edict } = props;
			if (edict === null) {
				return h("div", { className: "dss-card dss-empty" }, "尚未拟旨：中书省（Lead）需要用 sansheng_edict 定目标与验收。");
			}
			return h(
				"div",
				{ className: "dss-card" },
				h("div", { className: "dss-row" }, h("strong", null, edict.goal)),
				h(
					"div",
					{ className: "dss-row" },
					h("span", { className: "dss-badge dss-badge-info" }, edict.tier),
					h("span", { className: "dss-badge " + (edict.riskLevel === "low" ? "dss-badge-info" : edict.riskLevel === "medium" ? "dss-badge-pending" : "dss-badge-reject") }, "风险 " + String(edict.riskLevel ?? "low")),
					h("span", { className: "dss-muted" }, "编制上限 " + edict.rosterCap + " 人"),
					edict.departments.length > 0
						? h("span", { className: "dss-muted" }, "· " + edict.departments.join(" / "))
						: null,
					h("span", { className: "dss-muted" }, "· 第 " + String(edict.revision) + " 版"),
				),
				h("div", { className: "dss-row" }, h("strong", null, "验收")),
				h("ul", { className: "dss-list" }, (edict.acceptance ?? []).map((item, index) => h("li", { key: "a" + index }, item))),
				(edict.boundaries ?? []).length > 0
					? h("div", null,
						h("div", { className: "dss-row" }, h("strong", null, "边界")),
						h("ul", { className: "dss-list" }, edict.boundaries.map((item, index) => h("li", { key: "b" + index }, item))))
					: null,
				(edict.assumptions ?? []).length > 0
					? h("div", null, h("div", { className: "dss-row" }, h("strong", null, "假设")),
						h("ul", { className: "dss-list" }, edict.assumptions.map((item, index) => h("li", { key: "as" + index }, item))))
					: null,
				(edict.risks ?? []).length > 0
					? h("div", null, h("div", { className: "dss-row" }, h("strong", null, "风险预判")),
						h("ul", { className: "dss-list" }, edict.risks.map((item, index) => h("li", { key: "r" + index }, item))))
					: null,
				(edict.tools ?? []).length > 0
					? h("div", { className: "dss-row" }, h("strong", null, "工具"), h("span", { className: "dss-muted dss-mono" }, edict.tools.join(", ")))
					: null,
				(edict.dataScope ?? []).length > 0
					? h("div", { className: "dss-row" }, h("strong", null, "数据范围"), h("span", { className: "dss-muted dss-mono" }, edict.dataScope.join(", ")))
					: null,
				edict.budget
					? h("div", { className: "dss-row" }, h("strong", null, "预算"), h("span", { className: "dss-muted" }, edict.budget))
					: null,
			);
		}

		function Workstreams(props) {
			const { board } = props;
			const workstreams = board.edict !== null && Array.isArray(board.edict.workstreams) ? board.edict.workstreams : [];
			if (workstreams.length === 0) return null;
			const evidence = Array.isArray(board.evidence) ? board.evidence : [];
			const result = latestGate(board, "result");
			const reviewed = new Set(result !== null && Array.isArray(result.reviews) ? result.reviews.map((review) => review.workstreamId) : []);
			return h(
				"div",
				{ className: "dss-section" },
				h("h4", null, "工作流 · 逐部验收"),
				workstreams.map((workstream) => h(
					"div",
					{ className: "dss-task", key: workstream.id },
					h("div", { className: "dss-row" }, h("strong", null, workstream.id), h("span", { className: "dss-badge dss-badge-info" }, workstream.department)),
					h("div", { className: "dss-muted" }, workstream.deliverable),
					(Array.isArray(workstream.acceptance) && workstream.acceptance.length > 0)
						? h("ul", { className: "dss-list" }, workstream.acceptance.map((item, index) => h("li", { key: "wa" + index }, item)))
						: null,
					h("div", { className: "dss-task-meta" },
						h("span", { className: "dss-badge " + (evidence.some((record) => record.workstreamId === workstream.id) ? "dss-badge-pass" : "dss-badge-reject") },
							"证据 " + String(evidence.filter((record) => record.workstreamId === workstream.id).length)),
						h("span", { className: "dss-badge " + (reviewed.has(workstream.id) ? "dss-badge-pass" : "dss-badge-pending") }, reviewed.has(workstream.id) ? "已复审" : "未复审"),
					),
				)),
			);
		}

		function Appointments(props) {
			const { board } = props;
			if (!Array.isArray(board.appointments) || board.appointments.length === 0) {
				return h("p", { className: "dss-empty" }, board.edict !== null && board.edict.tier === "small" ? "small 轻量路径不任命六部：Lead 执行，一名独立 verifier 复核。" : "尚未任命六部。");
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
						appointment.role ? h("span", { className: "dss-badge dss-badge-pending" }, appointment.role) : null,
						appointment.writeScopes.length > 0
							? h("span", { className: "dss-muted dss-mono" }, appointment.writeScopes.join(", "))
							: null,
					),
				),
			);
		}

		function Warnings(props) {
			const { board, team } = props;
			const plan = latestGate(board, "plan");
			const result = latestGate(board, "result");
			const tasks = teamTasks(team);
			const completed = tasks.filter((task) => task.status === "completed");
			const covered = coveredIds(board);
			const missing = completed.filter((task) => covered.has(task.id) === false);
			const open = tasks.filter((task) => task.status !== "completed" && task.status !== "deleted");
			const warnings = [];
			if (board.abandoned !== null && board.abandoned !== undefined) warnings.push("本案件已放弃：" + board.abandoned.reason + "。重新进入模式可继续。");
			if (board.edict === null) warnings.push("尚未拟旨：先调用 sansheng_edict。");
			if (board.edict !== null && board.edict.tier !== "small" && plan === null) warnings.push("计划门未审：需要门下省用 sansheng_gate {kind:\"plan\"} 审议。");
			if (plan !== null && plan.verdict === "reject") warnings.push("计划被门封驳：按缺陷清单整改后重新拟旨。");
			if (board.edict !== null && board.edict.tier !== "small" && plan !== null && plan.verdict === "pass" && board.appointments.length === 0 && board.closure === null) {
				warnings.push("计划已过门但尚未派工：尚书省应任命六部后再开工。");
			}
			if (missing.length > 0) warnings.push("已完成任务缺少证据：" + missing.map((task) => task.id).join(", ") + "。");
			if (open.length > 0) warnings.push("未完成任务：" + open.map((task) => task.id).join(", ") + "。");
			if (result !== null && result.verdict === "reject") warnings.push("成果被门封驳：补充新证据后再审。");
			if (board.edict !== null && needsHuman(board) && plan !== null && plan.verdict === "pass" && board.closure === null) {
				const approvals = Array.isArray(board.approvals) ? board.approvals : [];
				const approval = approvals.length === 0 ? null : approvals[approvals.length - 1];
				if (approval === null || approval.rev <= plan.rev) warnings.push("large/高风险计划等待御批：请用户运行 /sansheng approve 或 /sansheng reject。");
			}
			for (const [scope, text] of [["plan", "计划门"], ["result", "成果门"]]) {
				const gate = latestGate(board, scope);
				const conditions = gate !== null && Array.isArray(gate.conditions) ? gate.conditions : [];
				if (conditions.length > 0) {
					const audit = latestAudit(board, scope);
					if (audit === null || audit.verdict !== "pass" || audit.rev <= gate.rev) warnings.push(text + "为有条件通过：需要独立审计确认条件。");
				}
			}
			if (board.edict !== null && (board.edict.riskLevel === "high" || board.edict.riskLevel === "irreversible")) {
				const audit = latestAudit(board, "result");
				const gate = latestGate(board, "result");
				if (audit === null || audit.verdict !== "pass" || (gate !== null && audit.rev <= gate.rev)) warnings.push("高风险案件：结案前需要独立的成果审计。");
			}
			if (result !== null && result.verdict === "pass") {
				const reviewed = reviewedIds(result);
				const unreviewed = completed.filter((task) => reviewed.has(task.id) === false);
				if (unreviewed.length > 0) warnings.push("成果门通过但任务缺少逐任务 verdict（旧记录）：" + unreviewed.map((task) => task.id).join(", ") + "。");
			}
			if (typeof board.updatedAt === "number" && Date.now() - board.updatedAt > 30 * 60 * 1000 && board.closure === null) {
				warnings.push("看板已 " + Math.round((Date.now() - board.updatedAt) / 60000) + " 分钟无新记录，检查成员是否停滞。");
			}
			if (warnings.length === 0) return null;
			return h(
				"div",
				{ className: "dss-section" },
				h("h4", null, "红区"),
				h("ul", { className: "dss-defects" }, warnings.map((warning, index) => h("li", { key: "w" + index }, warning))),
			);
		}

		function OverviewTab(props) {
			const { board, team } = props;
			const plan = latestGate(board, "plan");
			const result = latestGate(board, "result");
			const tasks = teamTasks(team);
			const completed = tasks.filter((task) => task.status === "completed").length;
			return h(
				"div",
				null,
				h("div", { className: "dss-stats dss-section" },
					h("span", { className: "dss-chip" }, "rev ", h("b", null, String(board.revision ?? 0))),
					h("span", { className: "dss-chip" }, "计划门 ", h("b", null, plan === null ? (board.edict !== null && board.edict.tier === "small" ? "不需要" : "待审") : plan.verdict === "pass" ? "通过" : "封驳")),
					h("span", { className: "dss-chip" }, "成果门 ", h("b", null, result === null ? "待审" : result.verdict === "pass" ? "通过" : "封驳")),
					h("span", { className: "dss-chip" }, "御批 ", h("b", null, latestApprovalLabel(board, plan))),
					h("span", { className: "dss-chip" }, "任务 ", h("b", null, completed + "/" + tasks.length)),
					h("span", { className: "dss-chip" }, "证据 ", h("b", null, String(board.evidence.length))),
					h("span", { className: "dss-chip" }, board.closure === null ? "进行中" : "已结案"),
				),
				h("div", { className: "dss-grid" },
					h("div", null,
						h("div", { className: "dss-section" }, h("h4", null, "制敕 · 中书省"), h(EdictCard, { edict: board.edict })),
						h(Workstreams, { board }),
						h("div", { className: "dss-section" }, h("h4", null, "派发 · 尚书省"), h(Appointments, { board })),
					),
					h("div", null,
						h("div", { className: "dss-section" }, h("h4", null, "计划门 · 门下省"), h(GateSection, { title: "第 " + String(board.planRounds ?? 1) + " 轮", gate: plan, notRequired: board.edict !== null && board.edict.tier === "small" })),
						h("div", { className: "dss-section" }, h("h4", null, "成果门 · 门下省"), h(GateSection, { title: "第 " + String(board.resultRounds ?? 1) + " 轮", gate: result })),
					),
				),
				h(Warnings, { board, team }),
				h(CaseArchive, { board }),
				h("div", { className: "dss-section" }, h("h4", null, "结案 · 尚书省汇总"), h(ClosureSummary, { board })),
			);
		}

		function CaseArchive(props) {
			const { board } = props;
			const cases = Array.isArray(board.cases) ? board.cases : [];
			if (cases.length === 0) return null;
			return h(
				"div",
				{ className: "dss-section" },
				h("h4", null, "宗卷历史 · 只读"),
				cases.slice().reverse().map((entry) => h(
					"div",
					{ className: "dss-task", key: "case-" + String(entry.caseId) },
					h("div", { className: "dss-row" },
						h("strong", null, "#" + String(entry.caseId)),
						h("span", { className: "dss-badge " + (entry.outcome === "closed" ? "dss-badge-pass" : "dss-badge-reject") }, entry.outcome === "closed" ? "已结案" : entry.outcome === "abandoned" ? "已放弃" : "未结"),
						h("span", { className: "dss-muted" }, String(entry.tier ?? "?")),
					),
					h("div", { className: "dss-muted" }, String(entry.goal ?? "（无目标）")),
					entry.abandonedReason ? h("div", { className: "dss-warn" }, "放弃原因：" + entry.abandonedReason) : null,
				)),
			);
		}

		function ClosureSummary(props) {
			const { board } = props;
			const closure = board.closure;
			if (closure === null) return h("p", { className: "dss-empty" }, "尚未结案。");
			return h(
				"div",
				{ className: "dss-card" },
				h("div", { className: "dss-row" }, h("strong", null, "结论"), h("span", { className: "dss-muted" }, "由 " + closure.closedBy + " 结案")),
				h("ul", { className: "dss-list" }, closure.conclusions.map((item, index) => h("li", { key: "c" + index }, item))),
				h("div", { className: "dss-row" }, h("strong", null, "交付物")),
				h("ul", { className: "dss-list" }, closure.deliverables.map((item, index) => h("li", { key: "d" + index }, item))),
				(closure.unknowns ?? []).length > 0
					? h("div", null,
						h("div", { className: "dss-row" }, h("strong", null, "残留未知")),
						h("ul", { className: "dss-list" }, closure.unknowns.map((item, index) => h("li", { key: "u" + index }, item))))
					: null,
			);
		}

		function TaskCard(props) {
			const { task, board, resultGate } = props;
			const covered = coveredIds(board);
			const reviewed = reviewedIds(resultGate);
			return h(
				"div",
				{ className: "dss-task" },
				h("strong", null, task.subject ?? task.id),
				h("div", { className: "dss-row dss-muted" }, h("span", null, task.id), h("span", null, "· " + (task.ownerName ?? "未认领"))),
				h("div", { className: "dss-task-meta" },
					task.status === "completed"
						? h("span", { className: "dss-badge dss-badge-pass" }, covered.has(task.id) ? "已取证" : "缺证据")
						: null,
					task.status === "completed" && resultGate !== null && resultGate.verdict === "pass"
						? h("span", { className: "dss-badge " + (reviewed.has(task.id) ? "dss-badge-pass" : "dss-badge-reject") }, reviewed.has(task.id) ? "已复审" : "未复审")
						: null,
					Array.isArray(task.writeScopes) && task.writeScopes.length > 0
						? h("span", { className: "dss-muted dss-mono" }, task.writeScopes.join(", "))
						: null,
				),
			);
		}

		function TasksTab(props) {
			const { board, team } = props;
			const tasks = teamTasks(team);

			const resultGate = latestGate(board, "result");
			const columns = [
				["pending", "待办"],
				["in_progress", "进行中"],
				["completed", "已完成"],
				["deleted", "已删除"],
			];
			return h(
				"div",
				{ className: "dss-kanban" },
				columns.map(([status, label]) => h(
					"div",
					{ key: status },
					h("div", { className: "dss-col-head" }, h("span", null, label), h("span", null, String(tasks.filter((task) => task.status === status).length))),
					tasks.filter((task) => task.status === status).map((task) => h(TaskCard, { key: task.id, task, board, resultGate })),
					tasks.filter((task) => task.status === status).length === 0 ? h("p", { className: "dss-empty" }, "—") : null,
				)),
			);
		}

		function GateDetail(props) {
			const { gate, kind, round, notRequired } = props;
			if (gate === null) {
				return h("div", { className: "dss-card" }, h("p", { className: "dss-empty" }, notRequired ? "small 轻量路径不需要计划门。" : kind + "尚未提交。"));
			}
			return h(
				"div",
				{ className: "dss-card" },
				h("div", { className: "dss-row" }, gateBadge(gate), h("strong", null, "第 " + String(round) + " 轮"), h("span", { className: "dss-muted" }, "由 " + gate.reviewer + " 判定")),
				(Array.isArray(gate.checked) && gate.checked.length > 0)
					? h("div", null,
						h("div", { className: "dss-row" }, h("strong", null, "核对项")),
						h("ul", { className: "dss-list" }, gate.checked.map((item, index) => h("li", { key: "k" + index }, item))))
					: null,
				(Array.isArray(gate.defects) && gate.defects.length > 0)
					? h("div", null,
						h("div", { className: "dss-row" }, h("strong", null, "封驳缺陷")),
						h("ul", { className: "dss-defects" }, gate.defects.map((item, index) => h("li", { key: "x" + index }, item))))
					: null,
				(Array.isArray(gate.conditions) && gate.conditions.length > 0)
					? h("div", null,
						h("div", { className: "dss-row" }, h("strong", null, "通过条件")),
						h("ul", { className: "dss-list" }, gate.conditions.map((item, index) => h("li", { key: "c" + index }, item))))
					: null,
				(Array.isArray(gate.reviews) && gate.reviews.length > 0)
					? h("div", null,
						h("div", { className: "dss-row" }, h("strong", null, "逐任务复审")),
						h("ul", { className: "dss-list" }, gate.reviews.map((review) => h("li", { key: review.taskId }, review.taskId + " · " + (review.verdict === "pass" ? "通过" : "封驳")))))
					: null,
				gate.summary ? h("p", { className: "dss-muted" }, gate.summary) : null,
			);
		}

		function AuditList(props) {
			const audits = Array.isArray(props.board.audits) ? props.board.audits : [];
			if (audits.length === 0) return h("p", { className: "dss-empty" }, "尚未独立审计。");
			return h("ul", { className: "dss-list" }, audits.slice().reverse().map((audit, index) => h("li", { key: "audit" + index },
				(audit.scope === "plan" ? "计划" : "成果") + " · " + audit.auditor + " · " + (audit.verdict === "pass" ? "通过" : "驳回")
				+ (audit.conditionsMet.length > 0 ? " · 条件 " + audit.conditionsMet.length + " 项" : ""))));
		}

		function GatesTab(props) {
			const { board } = props;
			return h(
				"div",
				null,
				h("div", { className: "dss-section" }, h("h4", null, "计划门 · 门下省（第 " + String(board.planRounds ?? 1) + " 轮）"), h(GateDetail, { gate: latestGate(board, "plan"), kind: "计划门", round: board.planRounds ?? 1, notRequired: board.edict !== null && board.edict.tier === "small" })),
				h("div", { className: "dss-section" }, h("h4", null, "成果门 · 门下省（第 " + String(board.resultRounds ?? 1) + " 轮）"), h(GateDetail, { gate: latestGate(board, "result"), kind: "成果门", round: board.resultRounds ?? 1 })),
				h("div", { className: "dss-section" }, h("h4", null, "独立审计 · 刑部/独立成员"), h(AuditList, { board })),
			);
		}

		function EvidenceTab(props) {
			const { board } = props;
			const evidence = Array.isArray(board.evidence) ? board.evidence : [];
			if (evidence.length === 0) return h("p", { className: "dss-empty" }, "尚未登记证据。");
			return h(
				"div",
				null,
				evidence.map((record) => h(
					"div",
					{ className: "dss-evidence", key: record.id },
					h("div", { className: "dss-row" },
						h("strong", null, record.taskId ?? "无任务"),
						record.workstreamId ? h("span", { className: "dss-badge dss-badge-info" }, record.workstreamId) : null,
						h("span", { className: "dss-badge " + (record.exitCode === 0 ? "dss-badge-pass" : "dss-badge-reject") }, "exit " + String(record.exitCode)),
						h("span", { className: "dss-muted" }, "由 " + record.submittedBy + " 提交"),
					),
					h("div", { className: "dss-row dss-mono" }, record.command),
					record.digest ? h("div", { className: "dss-row dss-muted dss-mono" }, "digest " + String(record.digest).slice(0, 16) + "…") : null,
					record.excerpt ? h("div", { className: "dss-row dss-muted" }, String(record.excerpt).slice(0, 240)) : null,
				)),
			);
		}

		function HistoryTab(props) {
			const { detail } = props;
			const [filter, setFilter] = react.useState("all");
			const entries = detail !== undefined && detail !== null && Array.isArray(detail.entries) ? detail.entries : [];
			const TASK_TOOLS = /^(spawn_teammate|send_message|list_agents|wait_agent|interrupt_agent|team_task_)/;
			const inFilter = (entry) => {
				if (filter === "all") return true;
				if (filter === "messages") return entry.kind === "user" || entry.kind === "assistant" || entry.kind === "inbox";
				if (filter === "tools") return entry.kind === "tool-call" || entry.kind === "tool-result";
				if (filter === "team") return (entry.kind === "tool-call" || entry.kind === "tool-result") && TASK_TOOLS.test(String(entry.tool ?? ""));
				if (filter === "governance") return (entry.kind === "tool-call" || entry.kind === "tool-result") && String(entry.tool ?? "").startsWith("sansheng_");
				if (filter === "errors") return entry.isError === true;
				return true;
			};
			const visible = entries.filter(inFilter).slice().reverse();
			const filters = [
				["all", "全部"],
				["messages", "消息"],
				["tools", "工具"],
				["team", "团队"],
				["governance", "治理"],
				["errors", "错误"],
			];
			return h(
				"div",
				null,
				h("p", { className: "dss-muted", style: { marginTop: 0 } }, "案卷详细历史：只记录消息正文、工具名/参数/结果，不含模型思考；较早条目会自动截断。"),
				h("div", { className: "dss-history-filters" }, filters.map(([id, label]) => h("button", {
					key: id,
					className: "dss-history-chip",
					"aria-pressed": filter === id,
					onClick: () => setFilter(id),
				}, label))),
				detail !== undefined && detail !== null && detail.dropped > 0
					? h("p", { className: "dss-muted" }, "仅保留最近 " + String(entries.length) + " 条，较早的 " + String(detail.dropped) + " 条已省略。")
					: null,
				visible.length === 0
					? h("p", { className: "dss-empty" }, "尚无详细历史。")
					: h("ul", { className: "dss-history-list" }, visible.map((entry) => h(
						"li",
						{ className: "dss-history-item", key: entry.id },
						h("div", { className: "dss-history-head" },
							h("span", { className: "dss-event-time" }, fmtTime(entry.at)),
							h("span", { className: "dss-badge " + (entry.kind === "tool-result" ? (entry.isError ? "dss-badge-reject" : "dss-badge-pass") : "dss-badge-pending") }, HISTORY_KINDS[entry.kind] ?? entry.kind),
							h("span", { className: "dss-history-title" }, String(entry.title ?? "")),
						),
						h("details", null,
							h("summary", null, "展开详情"),
							h("pre", { className: "dss-history-pre" }, String(entry.detail ?? "")),
						),
					))),
			);
		}

		function TimelineTab(props) {
			const { board } = props;
			const history = Array.isArray(board.history) ? board.history.slice().reverse() : [];
			if (history.length === 0) return h("p", { className: "dss-empty" }, "尚无时间线记录。");
			return h(
				"ul",
				{ className: "dss-timeline" },
				history.map((entry, index) => h(
					"li",
					{ className: "dss-event " + eventTone(entry), key: String(entry.rev ?? index) + "-" + index },
					h("span", { className: "dss-event-time" }, fmtTime(entry.at)),
					h("span", { className: "dss-badge dss-badge-pending" }, opLabel(entry.op)),
					h("div", { className: "dss-event-text" }, eventText(entry)),
					entry.by ? h("div", { className: "dss-muted" }, "by " + entry.by + " · rev " + String(entry.rev ?? "?")) : h("div", { className: "dss-muted" }, "rev " + String(entry.rev ?? "?")),
				)),
			);
		}

		function SanshengPanel(props) {
			const { board, team, detail, onClose } = props;
			const [tab, setTab] = react.useState("overview");
			const [error, setError] = react.useState(null);
			const tabs = [
				["overview", "总览"],
				["tasks", "任务"],
				["gates", "审议"],
				["evidence", "证据"],
				["timeline", "时间线"],
				["history", "详细历史"],
			];
			const render = () => {
				if (tab === "tasks") return h(TasksTab, { board, team });
				if (tab === "gates") return h(GatesTab, { board });
				if (tab === "evidence") return h(EvidenceTab, { board });
				if (tab === "timeline") return h(TimelineTab, { board });
				if (tab === "history") return h(HistoryTab, { detail });
				return h(OverviewTab, { board, team });
			};
			return h(
				"div",
				{ className: "dss-panel", role: "dialog", "aria-label": "三省六部看板" },
				h(
					"div",
					{ className: "dss-head" },
					h(
						"div",
						{ className: "dss-title" },
						h("strong", null, "三省六部 · 看板"),
						h("span", { className: "dss-pinyin" }, "Sān Shěng Liù Bù"),
						h("span", { className: "dss-chip" }, "rev ", h("b", null, String(board.revision ?? 0))),
						h("span", { className: "dss-chip" }, "案卷 ", h("b", null, "#" + String(board.caseId ?? 1))),
						board.closure !== null ? h("span", { className: "dss-chip" }, "已结案") : null,
						board.abandoned !== null && board.abandoned !== undefined ? h("span", { className: "dss-chip dss-warn" }, "已放弃") : null,
					),
					h("button", { className: "dss-close", onClick: onClose, title: "关闭" }, "×"),
				),
				h(
					"div",
					{ className: "dss-tabs", role: "tablist" },
					tabs.map(([key, label]) => h(
						"button",
						{
							key,
							role: "tab",
							"aria-selected": tab === key,
							className: "dss-tab" + (tab === key ? " dss-tab-on" : ""),
							onClick: () => setTab(key),
						},
						label,
					)),
				),
				h("div", { className: "dss-body" },
					error !== null ? h("div", { className: "dss-error" }, error) : null,
					render(),
				),
				h("div", { className: "dss-footer" }, "只读投影：状态来自当前会话事件日志；没有共享任务文件。成员内部轨迹请在 Agent Team 面板或侧栏会话中查看。"),
			);
		}

		function sanshengAction(props) {
			const { sessionId, useSession, useSessions } = props;
			const [open, setOpen] = react.useState(false);
			const previousActive = react.useRef(false);
			const snapshotSessionId = useSession((snapshot) => snapshot?.sessionId);
			const parentId = useSession((snapshot) => snapshot?.subagent?.address?.parentSessionId);
			const sessionReady = snapshotSessionId === sessionId;
			const leadSessionId = parentId ?? sessionId;
			const board = useSessions(
				(state) => state?.projectionsBySession?.[leadSessionId]?.values?.sansheng,
			);
			const team = useSessions(
				(state) => state?.projectionsBySession?.[leadSessionId]?.values?.agentTeam,
			);
			const detail = useSessions(
				(state) => state?.projectionsBySession?.[leadSessionId]?.values?.sanshengHistory,
			);

			const isLeadView = sessionReady && (parentId === undefined || parentId === null);
			react.useEffect(() => {
				const active = board !== undefined && board !== null && board.active === true;
				if (isLeadView && active && previousActive.current === false) setOpen(true);
				previousActive.current = active;
			}, [isLeadView, board === undefined || board === null ? false : board.active]);

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
			const tasks = teamTasks(team);
			const openTasks = tasks.filter((task) => task.status !== "completed" && task.status !== "deleted");
			const tone = result !== null && result.verdict === "pass"
				? "dss-dot-pass"
				: plan !== null && plan.verdict === "reject" || (typeof board.updatedAt === "number" && board.closure === null && Date.now() - board.updatedAt > 30 * 60 * 1000)
					? "dss-dot-warn"
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
				open ? h(SanshengPanel, { board, team, detail, onClose: () => setOpen(false) }) : null,
			);
		}

		function SanshengIcon(props) {
			const size = props.size || 18;
			return h("span", {
				style: {
					display: "inline-grid",
					placeItems: "center",
					width: size,
					height: size,
					fontSize: Math.max(11, Math.round(size * 0.62)),
					fontWeight: 600,
					color: props.active ? "var(--dsw-alias-state-business-primary)" : "currentColor",
				},
				"aria-hidden": "true",
			}, "省");
		}

		let boardTargetSessionId = null;
		const boardTargetListeners = new Set();
		function setBoardTarget(sessionId) {
			boardTargetSessionId = sessionId;
			for (const listener of boardTargetListeners) listener();
		}
		function useBoardTarget() {
			const [target, setTarget] = react.useState(boardTargetSessionId);
			react.useEffect(() => {
				const listener = () => setTarget(boardTargetSessionId);
				boardTargetListeners.add(listener);
				listener();
				return () => boardTargetListeners.delete(listener);
			}, []);
			return target;
		}

		function SanshengCornerAction(props) {
			const { sessionId, useSession, useSessions, openBoard } = props;
			const parentId = useSession((snapshot) => snapshot?.subagent?.address?.parentSessionId);
			const leadSessionId = parentId ?? sessionId;
			const board = useSessions((state) => state?.projectionsBySession?.[leadSessionId]?.values?.sansheng);
			if (board === undefined || board === null || board.active !== true) return null;
			return h("button", {
				type: "button",
				className: "dss-trigger",
				title: "打开军机处看板",
				onClick: () => openBoard(),
			}, h("span", { className: "dss-dot dss-dot-open" }), h("span", null, "三省六部·军机处"));
		}

		function SanshengRightTitle() {
			return h("span", null, "军机处看板");
		}

		function SanshengRightPanel(props) {
			const { sessionId, useSession, useSessions } = props;
			const parentId = useSession((snapshot) => snapshot?.subagent?.address?.parentSessionId);
			const leadSessionId = parentId ?? sessionId;
			const board = useSessions((state) => state?.projectionsBySession?.[leadSessionId]?.values?.sansheng);
			const team = useSessions((state) => state?.projectionsBySession?.[leadSessionId]?.values?.agentTeam);
			const detail = useSessions((state) => state?.projectionsBySession?.[leadSessionId]?.values?.sanshengHistory);
			const [tab, setTab] = react.useState("overview");
			if (board === undefined || board === null) {
				return h("div", { className: "dss-right" }, h("p", { className: "dss-empty" }, "当前会话没有三省六部看板。"));
			}
			const tabs = [
				["overview", "总览"],
				["tasks", "任务"],
				["gates", "审议"],
				["evidence", "证据"],
				["timeline", "时间线"],
				["history", "历史"],
			];
			const render = () => {
				if (tab === "tasks") return h(TasksTab, { board, team });
				if (tab === "gates") return h(GatesTab, { board });
				if (tab === "evidence") return h(EvidenceTab, { board });
				if (tab === "timeline") return h(TimelineTab, { board });
				if (tab === "history") return h(HistoryTab, { detail });
				return h(OverviewTab, { board, team });
			};
			return h(
				"div",
				{ className: "dss-right" },
				h("div", { className: "dss-right-head" },
					h("strong", null, "三省六部·军机处"),
					h("span", { className: "dss-muted" }, "案卷 #" + String(board.caseId ?? 1) + " · rev " + String(board.revision ?? 0)),
				),
				h("div", { className: "dss-page-tabs", role: "tablist" }, tabs.map(([key, label]) => h("button", {
					key,
					role: "tab",
					"aria-selected": tab === key,
					className: "dss-tab" + (tab === key ? " dss-tab-on" : ""),
					onClick: () => setTab(key),
				}, label))),
				h("div", { style: { paddingTop: "6px" } }, render()),
			);
		}

		function SanshengHeaderAction(props) {
			const { sessionId, useSession, useSessions, openBoard } = props;
			const parentId = useSession((snapshot) => snapshot?.subagent?.address?.parentSessionId);
			const leadSessionId = parentId ?? sessionId;
			const board = useSessions((state) => state?.projectionsBySession?.[leadSessionId]?.values?.sansheng);
			if (board === undefined || board === null || board.active !== true) return null;
			return h("button", {
				type: "button",
				className: "dss-trigger",
				title: "打开军机处看板",
				onClick: () => openBoard(leadSessionId),
			}, h("span", { className: "dss-dot dss-dot-open" }), h("span", null, "军机处"));
		}

		function SanshengPage(props) {
			const useSessions = props.useSessions;
			const projections = useSessions((state) => state.projectionsBySession);
			const byId = useSessions((state) => state.byId);
			const [tab, setTab] = react.useState("overview");
			const targetSessionId = useBoardTarget();
			const rows = react.useMemo(() => {
				const list = [];
				for (const [id, snapshot] of Object.entries(projections || {})) {
					const board = snapshot?.values?.sansheng;
					if (!board) continue;
					if (board.edict === null && board.closure === null && board.cases?.length === 0 && board.active !== true) continue;
					if (board.edict === null && board.closure === null && (board.caseId ?? 0) === 0 && board.active !== true) continue;
					list.push({ id, board, title: byId?.[id]?.title || String(id).slice(0, 8), updatedAt: byId?.[id]?.updatedAt || board.updatedAt || 0 });
				}
				list.sort((left, right) => right.updatedAt - left.updatedAt || String(left.id).localeCompare(String(right.id)));
				return list;
			}, [projections, byId]);
			const active = rows.find((row) => row.id === targetSessionId) || rows[0] || null;
			const board = active?.board ?? null;
			const team = active === null ? undefined : projections?.[active.id]?.values?.agentTeam;
			const detail = active === null ? undefined : projections?.[active.id]?.values?.sanshengHistory;
			const tabs = [
				["overview", "总览"],
				["tasks", "任务"],
				["gates", "审议"],
				["evidence", "证据"],
				["timeline", "时间线"],
				["history", "详细历史"],
			];
			const render = () => {
				if (board === null) return h("p", { className: "dss-empty" }, "当前没有三省六部看板。激活模式后，在此查看案卷。");
				if (tab === "tasks") return h(TasksTab, { board, team });
				if (tab === "gates") return h(GatesTab, { board });
				if (tab === "evidence") return h(EvidenceTab, { board });
				if (tab === "timeline") return h(TimelineTab, { board });
				if (tab === "history") return h(HistoryTab, { detail });
				return h(OverviewTab, { board, team });
			};
			return h(
				"div",
				{ className: "dss-page" },
				h("div", { className: "dss-page-inner" },
					h("div", { className: "dss-page-head" },
						h("h1", { className: "dss-page-title" }, "军机处 · 三省六部"),
						h("span", { className: "dss-page-sub" }, board === null ? "暂无活动案卷" : "案卷 #" + String(board.caseId ?? 1) + " · rev " + String(board.revision ?? 0) + (active?.title ? " · " + active.title : "")),
						h("button", { type: "button", className: "dss-link", onClick: () => props.onClose && props.onClose() }, "返回会话"),
					),
					board === null ? render() : h("div", null,
						h("div", { className: "dss-page-tabs", role: "tablist" }, tabs.map(([key, label]) => h("button", {
							key,
							role: "tab",
							"aria-selected": tab === key,
							className: "dss-tab" + (tab === key ? " dss-tab-on" : ""),
							onClick: () => setTab(key),
						}, label))),
						h("div", { className: "dss-body", style: { padding: "0" } }, render()),
					),
				),
			);
		}

		function apply(ctx) {
			ctx.effect(() => ensureStyle(), "sansheng: board style");
			const actions = {
				openBoard() {
					ctx.sidebarRight.openTab("sansheng");
				},
			};
			ctx.slots.inject("conversation.session.header.utilities", () =>
				ctx.slots.register(
					{
						name: "conversation.session.header.utilities",
						id: "sansheng",
						order: -5,
						inject: () => actions,
					},
					SanshengCornerAction,
				),
			);
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: "sansheng",
				kind: "sansheng",
				priority: "extension",
				title: () => "军机处看板",
				guide: [{
					id: "open",
					order: 30,
					title: () => "军机处看板",
					description: () => "查看当前会话的三省六部案卷",
					icon: SanshengIcon,
				}],
			}), "sansheng: right sidebar type");
			ctx.slots.inject("sidebar.right.pane.tab", () =>
				ctx.slots.register(
					{
						name: "sidebar.right.pane.tab",
						key: "sansheng",
					},
					SanshengRightPanel,
				),
			);
			ctx.slots.inject("sidebar.right.pane.tab.title", () =>
				ctx.slots.register(
					{
						name: "sidebar.right.pane.tab.title",
						key: "sansheng",
					},
					SanshengRightTitle,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
