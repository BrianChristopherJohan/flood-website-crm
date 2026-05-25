/**
 * CRM Website — Settings page E2E (`/settings`).
 *
 * The settings page is a client-side, localStorage-backed (`crmSettings`)
 * configuration engine. These specs cover:
 *   • hydration from clean storage (defaults, no unsaved pill, locked Save)
 *   • change detection → "Unsaved changes" pill + Save/Cancel unlock
 *   • Save (800 ms latency, disabled blocker, persistence, re-lock)
 *   • Cancel / discard, Hard reset (clears storage, restores defaults)
 *   • Export (pretty-printed crm-settings.json download)
 *   • Data Management Live-Mode gating of the refresh interval
 *   • Connection Diagnostics (Java API → /api/nodes, Maps → /api/health)
 *
 * Auth is handled by the shared `loginAsAdmin` command. We strip only the
 * `crmSettings` blob before each test so the auth session survives.
 */
describe("CRM Settings", () => {
  const DEFAULT_SYSTEM_NAME = "Flood Management CRM";

  beforeEach(() => {
    cy.loginAsAdmin();
    // Clean slate for the settings blob WITHOUT wiping the auth tokens.
    cy.window().then((w) => w.localStorage.removeItem("crmSettings"));
  });

  // ── Hydration ─────────────────────────────────────────────────────────────
  describe("Hydration", () => {
    it("loads General defaults from clean storage with the form locked", () => {
      cy.visit("/settings");
      cy.waitForPageLoad();

      cy.get('[data-cy="settings-system-name"]').should("have.value", DEFAULT_SYSTEM_NAME);
      // Pristine load → no unsaved pill, Save disabled.
      cy.get('[data-cy="settings-unsaved"]').should("not.exist");
      cy.get('[data-cy="settings-save"]').should("be.disabled");
      cy.get('[data-cy="settings-cancel"]').should("be.disabled");
    });
  });

  // ── Change detection & UI lock sync ───────────────────────────────────────
  describe("Change detection & locking", () => {
    it("surfaces the unsaved pill and unlocks Save + Cancel after a mutation", () => {
      cy.visit("/settings");
      cy.waitForPageLoad();

      cy.get('[data-cy="settings-system-name"]').clear().type("My Control Center");

      cy.get('[data-cy="settings-unsaved"]').should("be.visible");
      cy.get('[data-cy="settings-save"]').should("not.be.disabled");
      cy.get('[data-cy="settings-cancel"]').should("not.be.disabled");
    });

    it("re-locks when the value is manually returned to its saved state", () => {
      cy.visit("/settings");
      cy.waitForPageLoad();

      cy.get('[data-cy="settings-system-name"]').clear().type("X");
      cy.get('[data-cy="settings-unsaved"]').should("be.visible");
      cy.get('[data-cy="settings-system-name"]').clear().type(DEFAULT_SYSTEM_NAME);
      // Deep structural compare → identical → pill gone, Save locked again.
      cy.get('[data-cy="settings-unsaved"]').should("not.exist");
      cy.get('[data-cy="settings-save"]').should("be.disabled");
    });
  });

  // ── Save ──────────────────────────────────────────────────────────────────
  describe("Save", () => {
    it("disables during the 800 ms write, persists, then re-locks", () => {
      cy.visit("/settings");
      cy.waitForPageLoad();

      cy.get('[data-cy="settings-system-name"]').clear().type("Persisted CRM");
      cy.get('[data-cy="settings-save"]').click();

      // During (isSaving) AND after (no changes) the Save button stays disabled,
      // which is the double-submit blocker we want.
      cy.get('[data-cy="settings-save"]').should("be.disabled");

      // Resolves with a success toast + the pill clears.
      cy.contains(/saved successfully/i).should("be.visible");
      cy.get('[data-cy="settings-unsaved"]').should("not.exist");

      // Flushed to localStorage.
      cy.window().then((w) => {
        const blob = JSON.parse(w.localStorage.getItem("crmSettings") || "{}");
        expect(blob.systemName).to.eq("Persisted CRM");
      });
    });
  });

  // ── Cancel / discard ──────────────────────────────────────────────────────
  describe("Cancel / discard", () => {
    it("reverts pending edits to the last saved snapshot and re-locks", () => {
      cy.visit("/settings");
      cy.waitForPageLoad();

      cy.get('[data-cy="settings-system-name"]').clear().type("Will be discarded");
      cy.get('[data-cy="settings-cancel"]').click();

      cy.get('[data-cy="settings-system-name"]').should("have.value", DEFAULT_SYSTEM_NAME);
      cy.get('[data-cy="settings-unsaved"]').should("not.exist");
      cy.contains(/reverted/i).should("be.visible");
    });
  });

  // ── Hard factory reset ────────────────────────────────────────────────────
  describe("Hard reset", () => {
    it("clears crmSettings and restores defaults live (no reload)", () => {
      cy.visit("/settings");
      cy.waitForPageLoad();

      // Save a non-default value first so reset has something to undo.
      cy.get('[data-cy="settings-system-name"]').clear().type("Temp Name");
      cy.get('[data-cy="settings-save"]').click();
      cy.contains(/saved successfully/i).should("be.visible");

      cy.get('[data-cy="settings-reset"]').click();
      cy.contains(/reset to defaults/i).should("be.visible");

      cy.get('[data-cy="settings-system-name"]').should("have.value", DEFAULT_SYSTEM_NAME);
      cy.window().then((w) => {
        expect(w.localStorage.getItem("crmSettings")).to.be.null;
      });
    });
  });

  // ── Export ────────────────────────────────────────────────────────────────
  describe("Export", () => {
    it("produces a Blob download and a success toast", () => {
      cy.visit("/settings");
      cy.waitForPageLoad();

      // Stub the object-URL plumbing so no real file lands on disk, and so we
      // can assert the export was driven by a Blob.
      cy.window().then((w) => {
        cy.stub(w.URL, "createObjectURL").as("createObjectURL").returns("blob:mock-url");
        cy.stub(w.URL, "revokeObjectURL").as("revokeObjectURL");
      });

      cy.get('[data-cy="settings-export"]').click();

      cy.get("@createObjectURL").should("have.been.calledWithMatch", Cypress.sinon.match.instanceOf(Blob));
      cy.contains(/exported/i).should("be.visible");
    });
  });

  // ── Data Management — Live-Mode gating ────────────────────────────────────
  describe("Data Management — Live Mode gating", () => {
    it("greys out + disables the refresh interval when Live Mode is OFF", () => {
      cy.visit("/settings");
      cy.waitForPageLoad();
      cy.contains("button", /data management/i).click();

      // Enabled while Live Mode is on.
      cy.get('[data-cy="settings-refresh-input"]').should("not.be.disabled");

      cy.get('[data-cy="settings-live-mode"]').uncheck({ force: true });

      cy.get('[data-cy="settings-refresh-input"]').should("be.disabled");
      cy.get('[data-cy="settings-refresh-block"]').should("have.class", "pointer-events-none");
    });
  });

  // ── Connection Diagnostics ────────────────────────────────────────────────
  describe("Connection Diagnostics", () => {
    it("reports Java API success when /api/nodes responds 200", () => {
      cy.interceptNodes(); // GET /api/nodes → fixture, 200
      cy.visit("/settings");
      cy.waitForPageLoad();
      cy.contains("button", /integrations/i).click();

      cy.get('[data-cy="settings-test-java"]').click();
      cy.contains(/Java API responded successfully/i).should("be.visible");
    });

    it("reports Java API failure when /api/nodes responds 500", () => {
      cy.intercept("GET", "/api/nodes", { statusCode: 500, body: {} }).as("nodesErr");
      cy.visit("/settings");
      cy.waitForPageLoad();
      cy.contains("button", /integrations/i).click();

      cy.get('[data-cy="settings-test-java"]').click();
      cy.contains(/Java API connection failed/i).should("be.visible");
    });

    it("reports the app server reachable when /api/health responds 200 (Maps)", () => {
      cy.intercept("GET", "/api/health", { statusCode: 200, body: { ok: true } }).as("health");
      cy.visit("/settings");
      cy.waitForPageLoad();
      cy.contains("button", /integrations/i).click();

      cy.get('[data-cy="settings-test-maps"]').click();
      cy.contains(/application server is reachable/i).should("be.visible");
    });
  });

  // ── Performance SLA (excluding the intentional 800 ms save latency) ───────
  describe("Performance SLA", () => {
    it("renders the settings page and reflects a mutation in well under 1 s", () => {
      cy.visit("/settings");
      cy.waitForPageLoad();
      cy.get('[data-cy="settings-system-name"]').should("be.visible");

      const start = performance.now();
      cy.get('[data-cy="settings-system-name"]').clear().type("Speed Test");
      cy.get('[data-cy="settings-unsaved"]')
        .should("be.visible")
        .then(() => {
          // Sub-second SLA for interactive state changes (the 800 ms wrapper
          // only applies inside handleSave, which this does not exercise).
          expect(performance.now() - start).to.be.lessThan(1000);
        });
    });
  });
});
