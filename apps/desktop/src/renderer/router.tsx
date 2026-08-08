import {
	createHashHistory,
	createRootRoute,
	createRoute,
	createRouter,
	redirect,
} from "@tanstack/react-router"
import { AgentHubPage } from "./components/agent-hub-page"
import { AutomationDetail } from "./components/automations/automation-detail"
import { AutomationRunDetail } from "./components/automations/automation-run-detail"
import { AutomationsPage } from "./components/automations/automations-page"
import { InboxEmptyState } from "./components/automations/inbox-empty-state"
import { CommunityPage } from "./components/community-page"
import { ErrorPage } from "./components/error-page"
import { HomeChat } from "./components/home-chat"
import { NewChat } from "./components/new-chat"
import { NotFoundPage } from "./components/not-found-page"
import { RootLayout } from "./components/root-layout"
import { SessionRoute } from "./components/session-route"
import { AboutSettings } from "./components/settings/about-settings"
import { AccountSettings } from "./components/settings/account-settings"
import { GeneralSettings } from "./components/settings/general-settings"
import { NotificationSettings } from "./components/settings/notification-settings"
import { PermissionSettings } from "./components/settings/permission-settings"
import { ProviderSettings } from "./components/settings/provider-settings"
import { ServerSettings } from "./components/settings/server-settings"
import { ConnectorsSettings } from "./components/settings/connectors-settings"
import { SettingsPage } from "./components/settings/settings-page"
import { SetupSettings } from "./components/settings/setup-settings"
import { StoreSettings } from "./components/settings/store-settings"
import { WorktreeSettings } from "./components/settings/worktree-settings"
import { SidebarLayout } from "./components/sidebar-layout"
import { TeamPage } from "./components/team-page"
import { TemplatesPage } from "./components/templates-page"

// ============================================================
// Route tree
// ============================================================

const rootRoute = createRootRoute({
	component: RootLayout,
	errorComponent: ErrorPage,
	notFoundComponent: NotFoundPage,
})

const sidebarLayout = createRoute({
	getParentRoute: () => rootRoute,
	id: "sidebar",
	component: SidebarLayout,
})

const indexRoute = createRoute({
	getParentRoute: () => sidebarLayout,
	path: "/",
	component: NewChat,
})

const homeRoute = createRoute({
	getParentRoute: () => sidebarLayout,
	path: "home",
	component: HomeChat,
})

const templatesRoute = createRoute({
	getParentRoute: () => sidebarLayout,
	path: "templates",
	component: TemplatesPage,
})

const agentHubRoute = createRoute({
	getParentRoute: () => sidebarLayout,
	path: "agent/$agentId",
	component: AgentHubPage,
})

const communityRoute = createRoute({
	getParentRoute: () => sidebarLayout,
	path: "community",
	component: CommunityPage,
})

const teamRoute = createRoute({
	getParentRoute: () => sidebarLayout,
	path: "team",
	component: TeamPage,
})

const projectRoute = createRoute({
	getParentRoute: () => sidebarLayout,
	path: "project/$projectSlug",
})

const projectIndexRoute = createRoute({
	getParentRoute: () => projectRoute,
	path: "/",
	component: NewChat,
})

const sessionRoute = createRoute({
	getParentRoute: () => projectRoute,
	path: "session/$sessionId",
	component: SessionRoute,
})

const settingsRoute = createRoute({
	getParentRoute: () => sidebarLayout,
	path: "settings",
	component: SettingsPage,
})

const settingsIndexRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "/",
	beforeLoad: () => {
		throw redirect({ to: "/settings/general" })
	},
})

const settingsGeneralRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "general",
	component: GeneralSettings,
})

const settingsAccountRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "account",
	component: AccountSettings,
})

const settingsServersRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "servers",
	component: ServerSettings,
})

const settingsNotificationsRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "notifications",
	component: NotificationSettings,
})

const settingsSetupRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "setup",
	component: SetupSettings,
})

const settingsProvidersRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "providers",
	component: ProviderSettings,
})

const settingsPermissionsRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "permissions",
	component: PermissionSettings,
})

const settingsWorktreesRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "worktrees",
	component: WorktreeSettings,
})

const settingsConnectorsRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "connectors",
	component: ConnectorsSettings,
})

const settingsStoreRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "store",
	component: StoreSettings,
})

const settingsAboutRoute = createRoute({
	getParentRoute: () => settingsRoute,
	path: "about",
	component: AboutSettings,
})

const automationsRoute = createRoute({
	getParentRoute: () => sidebarLayout,
	path: "automations",
	component: AutomationsPage,
})

const automationsIndexRoute = createRoute({
	getParentRoute: () => automationsRoute,
	path: "/",
	component: InboxEmptyState,
})

const automationDetailRoute = createRoute({
	getParentRoute: () => automationsRoute,
	path: "$automationId",
})

const automationDetailIndexRoute = createRoute({
	getParentRoute: () => automationDetailRoute,
	path: "/",
	component: AutomationDetail,
})

const automationRunRoute = createRoute({
	getParentRoute: () => automationDetailRoute,
	path: "runs/$runId",
	component: AutomationRunDetail,
})

const routeTree = rootRoute.addChildren([
	sidebarLayout.addChildren([
		indexRoute,
		homeRoute,
		templatesRoute,
		agentHubRoute,
		communityRoute,
		teamRoute,
		projectRoute.addChildren([projectIndexRoute, sessionRoute]),
		automationsRoute.addChildren([
			automationsIndexRoute,
			automationDetailRoute.addChildren([automationDetailIndexRoute, automationRunRoute]),
		]),
		settingsRoute.addChildren([
			settingsIndexRoute,
			settingsGeneralRoute,
			settingsAccountRoute,
			settingsServersRoute,
			settingsNotificationsRoute,
			settingsProvidersRoute,
			settingsPermissionsRoute,
			settingsConnectorsRoute,
			settingsWorktreesRoute,
			settingsStoreRoute,
			settingsSetupRoute,
			settingsAboutRoute,
		]),
	]),
])

// ============================================================
// Router instance
// ============================================================

const hashHistory = createHashHistory()

export const router = createRouter({
	routeTree,
	history: hashHistory,
	defaultErrorComponent: ErrorPage,
	defaultNotFoundComponent: NotFoundPage,
})

export type AppRouter = typeof router

// ============================================================
// Type-safe module augmentation
// ============================================================

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router
	}
}
