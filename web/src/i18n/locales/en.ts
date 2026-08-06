// English translation resources — the source of truth for the UI copy.
//
// Keep keys flat per namespace. Nested objects are allowed but react-i18next's
// selector syntax (`$ => $.foo.bar`) is only useful inside TypeScript; English
// here is the canonical form importers reference when they write `t('key')`.
//
// Anything missing here falls back to the key itself (i18next default), so an
// unwritten string surfaces as e.g. "common.cancel" instead of a blank — no
// need to fill every key with a placeholder.

export const common = {
  // Generic actions / labels reused across pages.
  save: "Save",
  cancel: "Cancel",
  close: "Close",
  back: "Back",
  done: "Done",
  edit: "Edit",
  delete: "Delete",
  confirm: "Confirm",
  yes: "Yes",
  no: "No",
  ok: "OK",
  loading: "Loading…",
  error: "Error",
  retry: "Retry",
  search: "Search",
  newChat: "New chat",
  send: "Send",
  stop: "Stop",
  copy: "Copy",
  copied: "Copied",
  expand: "Expand",
  collapse: "Collapse",
  refresh: "Refresh",
  signOut: "Sign out",
  notFoundTitle: "Page not found",
  notFoundDescription: "The URL you followed doesn't match any route in this app.",
  notFoundBack: "Back to home",
  newSession: "New session",
  other: "Other",
} as const;

export const sidebar = {
  chat: "Chat",
  tasks: "Tasks",
  inbox: "Inbox",
  settings: "Settings",
  archived: "Archived",
  pinned: "Pinned",
  shared: "Shared",
  projects: "Projects",
  newProject: "New project",
  searchChats: "Search chats",
  you: "You",
  unset: "Guest",
} as const;

export const settings = {
  title: "Settings",
  back: "Back",
  groups: {
    general: "General",
    desktop: "Desktop",
    admin: "Admin",
    archived: "Archived",
  },
  sections: {
    appearance: "Appearance",
    git: "Git",
    shortcuts: "Keyboard shortcuts",
    account: "Account",
    members: "Members",
    policies: "Policies",
    sharing: "Sharing",
    archived: "Archived sessions",
    cli: "Local CLI",
    updates: "Updates",
  },
  appearance: {
    title: "Appearance",
    description: "Theme, color palette, and font controls.",
    theme: "Theme",
    themeSystem: "System",
    themeLight: "Light",
    themeDark: "Dark",
    palette: "Color palette",
    paletteDescription: "Re-skin the app with a different color scheme.",
    language: "Language",
    languageDescription: "Switch the UI between English and Chinese.",
    fontSize: "Interface size",
    fontFamily: "Interface font",
    codeFont: "Code font",
    terminalTheme: "Terminal theme",
  },
  account: {
    title: "Account",
    signedInAs: "Signed in as",
    changePassword: "Change password",
    signOut: "Sign out",
  },
  git: {
    title: "Git",
    description: "Configure how Omnigent works with Git.",
    defaultBaseBranch: "Default base branch",
    defaultBaseBranchDescription: "Pre-filled when naming a new worktree branch in the composer.",
  },
  shortcuts: {
    title: "Keyboard shortcuts",
    description: "Keyboard reference for the editor and chat.",
  },
  members: {
    title: "Members",
    description: "Manage who can access this workspace.",
  },
  policies: {
    title: "Policies",
    description: "Server-wide policies for sessions and tools.",
  },
  sharing: {
    title: "Sharing",
    description: "Grant session access to other members.",
  },
  archived: {
    title: "Archived sessions",
    description: "Sessions you've archived. Restore one to the sidebar, or delete it for good.",
    unarchive: "Unarchive",
    delete: "Delete",
    empty: "No archived sessions.",
  },
  cli: {
    title: "Local CLI",
    description: "The Omnigent command-line tool this app uses to run a local server and connect this machine as a runner.",
    descriptionShort: "Install and configure the local CLI runner.",
  },
  updates: {
    title: "Updates",
    description: "Desktop app update preferences for this installed Omnigent shell.",
    descriptionShort: "Check for app updates.",
  },
} as const;

export const chat = {
  composer: {
    placeholder: "Message the agent…",
    placeholderWithFile: "Message about the selected file…",
    attachFile: "Attach file",
    send: "Send",
    stop: "Stop",
    queued: "Queued",
    queuedAria: "Queued message",
    removeQueued: "Remove queued message",
    slashCommandsTitle: "Slash commands",
    filesMentionedTitle: "Files",
  },
  status: {
    connecting: "Connecting…",
    typing: "Agent is typing",
    thinking: "Agent is thinking",
    running: "Running",
    idle: "Idle",
    error: "Something went wrong",
  },
  empty: {
    title: "Start a new conversation",
    description: "Ask the agent to help with a task in your workspace.",
    cta: "New chat",
  },
  errors: {
    runnerOffline: "Runner is offline. Start the local runner to continue.",
    runnerNotLoggedIn: "Please run ./login to authenticate the runner.",
    notLoggedIn: "Not logged in",
    sendFail: "Failed to send message.",
    retry: "Retry",
  },
  code: {
    copy: "Copy code",
    copied: "Copied",
    find: "Find",
    replace: "Replace",
  },
  input: {
    dropFile: "Drop file to attach",
  },
} as const;

export const auth = {
  login: {
    title: "Sign in",
    description: "Sign in to your workspace.",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    submitLoading: "Signing in…",
    noAccount: "No account yet?",
    registerCta: "Create one",
    error: "Incorrect email or password.",
  },
  register: {
    title: "Create account",
    description: "The first account becomes the workspace admin.",
    email: "Email",
    password: "Password",
    submit: "Create account",
    submitLoading: "Creating…",
    hasAccount: "Already have an account?",
    loginCta: "Sign in",
  },
  setup: {
    title: "Create admin",
    description: "Bootstrap the workspace with the first admin account.",
    email: "Email",
    password: "Password",
    submit: "Create admin",
  },
  approve: {
    title: "Approve request",
    description: "The agent is asking for permission to continue.",
    approve: "Approve",
    deny: "Deny",
  },
} as const;

export const tasks = {
  title: "Tasks",
  empty: "No tasks yet.",
  create: "Create task",
  schedule: "Schedule",
  cancel: "Cancel",
  save: "Save",
  delete: "Delete",
  runNow: "Run now",
  name: "Name",
  prompt: "Prompt",
  cron: "Schedule (cron)",
  timezone: "Timezone",
  enabled: "Enabled",
  disabled: "Disabled",
  lastRun: "Last run",
  nextRun: "Next run",
  status: "Status",
  deleteConfirm: "Delete this task?",
} as const;

export const inbox = {
  title: "Inbox",
  empty: "No inbox items.",
  markRead: "Mark read",
  markUnread: "Mark unread",
  archive: "Archive",
  unarchive: "Unarchive",
  delete: "Delete",
  reply: "Reply",
  from: "From",
  subject: "Subject",
  received: "Received",
} as const;
