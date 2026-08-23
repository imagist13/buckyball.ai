# Test Plan

## Overview

End-to-end test plan for the Claude Chat application covering all pages, core user flows, plugin management, settings, layout functionality, and V2 features (project panel, skills editor, chat UI enhancements).

---

## 1. Page Rendering Tests

| Test Case | Route | Expected Result |
|-----------|-------|-----------------|
| Home redirect | `/` | Redirects to `/chat` |
| Chat page loads | `/chat` | Chat interface renders with input area and sidebar |
| Specific conversation loads | `/chat/[id]` | Loads conversation with message history |
| Skills list page | `/plugins` | Skills list renders with search and filter controls |
| MCP management page | `/plugins/mcp` | MCP server list renders with add/edit controls |
| Settings page | `/settings` | Settings form renders with current values |
| Settings skills tab | `/settings?tab=skills` | Skills editor renders with list and editor panes |

---

## 2. Chat Flow Tests

### 2.1 New Conversation
- Click "New Chat" button
- Verify empty conversation is created
- Verify URL updates to `/chat/[new-id]`

### 2.2 Send Message
- Type message in input area
- Press Enter or click send button
- Verify message appears in conversation
- Verify input clears after sending

### 2.3 Streaming Response (SSE)
- Send a message
- Verify streaming indicator appears
- Verify text appears incrementally
- Verify streaming indicator disappears when complete

### 2.4 Markdown and Code Highlighting
- Send message that triggers code in response
- Verify Markdown renders correctly (headers, lists, bold, italic)
- Verify code blocks have syntax highlighting
- Verify inline code renders correctly

### 2.5 Chat History
- Create multiple conversations
- Verify sidebar shows conversation list
- Verify conversations are ordered by recency

### 2.6 Switch Conversation
- Click on a different conversation in sidebar
- Verify URL updates
- Verify message history loads for selected conversation

### 2.7 Delete Conversation
- Click delete on a conversation
- Verify confirmation prompt appears
- Confirm deletion
- Verify conversation removed from sidebar

### 2.8 Abort Generation
- Send a message
- Click stop/abort button during streaming
- Verify streaming stops
- Verify partial response is preserved

### 2.9 Token Usage Display
- Send a message and receive response
- Verify token usage information is displayed
- Verify counts update after each exchange

---

## 3. Plugin Management Tests

### 3.1 Skills List
- Navigate to `/plugins`
- Verify skills list renders
- Verify each skill shows name, description, and source

### 3.2 Search Skills
- Type in search input
- Verify list filters in real time
- Verify "no results" state when no match

### 3.3 Filter by Source
- Click source filter options
- Verify list updates to show only matching source
- Verify filter can be cleared

### 3.4 MCP Server List
- Navigate to `/plugins/mcp`
- Verify server list renders
- Verify each server shows name, status, and tools count

### 3.5 Add MCP Server
- Click "Add Server" button
- Fill in server configuration form
- Submit form
- Verify new server appears in list

### 3.6 Edit MCP Server
- Click edit on an existing server
- Modify configuration
- Save changes
- Verify changes are reflected in list

### 3.7 Delete MCP Server
- Click delete on a server
- Confirm deletion
- Verify server removed from list

### 3.8 JSON Configuration Editor
- Switch to JSON edit mode
- Verify JSON is valid and formatted
- Edit JSON directly
- Save and verify changes apply

---

## 4. Settings Page Tests

### 4.1 Read Current Settings
- Navigate to `/settings`
- Verify all settings display current values
- Verify form fields are populated correctly

### 4.2 Form Mode Edit
- Modify a setting via form input
- Verify the change is reflected in the form
- Save settings
- Reload page and verify persistence

### 4.3 JSON Mode Edit
- Switch to JSON editor mode
- Verify JSON contains all current settings
- Edit a value in JSON
- Save and verify the change applies

### 4.4 Mode Switch
- Toggle between Form and JSON modes
- Verify data is consistent between modes
- Verify unsaved changes carry over between modes

### 4.5 Save Settings
- Make changes
- Click save
- Verify success feedback
- Verify changes persist after page reload

### 4.6 Reset Settings
- Modify settings
- Click reset
- Verify settings revert to defaults
- Verify confirmation prompt before reset

---

## 5. Layout Functionality Tests

### 5.1 Sidebar Collapse/Expand
- Click sidebar toggle button
- Verify sidebar collapses with animation
- Click again to expand
- Verify sidebar expands with animation
- Verify main content area adjusts width

### 5.2 Theme Switch (Light/Dark)
- Click theme toggle
- Verify theme changes to dark mode
- Verify all components respect theme
- Click again to switch back to light mode
- Verify no flash of wrong theme on page load

### 5.3 Navigation Menu Highlight
- Navigate to each route
- Verify corresponding nav item is highlighted/active
- Verify other nav items are not highlighted

### 5.4 Mobile Responsive
- Set viewport to mobile size (375x667)
- Verify sidebar is hidden by default
- Verify hamburger menu appears
- Open sidebar via hamburger menu
- Verify sidebar overlays content
- Navigate and verify sidebar closes

### 5.5 Three-Column Layout (V2)
- Navigate to `/chat/[id]`
- Verify three-column layout: sidebar + main + right panel
- Verify right panel auto-opens on `/chat/[id]`
- Verify right panel hidden on non-chat routes
- Verify main content adjusts width when panel collapses

---

## 6. Project Panel Tests (V2)

### 6.1 Panel Auto-Show
- Navigate to `/chat/[id]`
- Verify right panel is visible (width ~320px)
- Navigate to `/settings`
- Verify right panel is hidden

### 6.2 Panel Tabs
- Verify "Files" tab is active by default
- Click "Tasks" tab
- Verify Tasks content area activates
- Click "Files" tab
- Verify Files content area activates

### 6.3 Panel Collapse/Expand
- Click "Close panel" button (PanelRightClose icon)
- Verify panel collapses to icon strip
- Click "Open panel" button (FolderTree icon)
- Verify panel expands to full width

### 6.4 File Tree
- Verify file tree loads and renders nodes
- Click a directory node
- Verify directory expands showing children
- Click again to collapse
- Verify directory collapses

### 6.5 File Search
- Type in "Filter files..." input
- Verify tree filters to matching file names
- Clear search
- Verify full tree re-renders

### 6.6 File Preview
- Click a file node in the tree
- Verify file preview loads with syntax highlighting
- Verify line numbers are displayed
- Verify language badge is shown
- Verify "Back to file tree" button works
- Verify "Copy path" button works

### 6.7 Task List
- Switch to Tasks tab
- Verify task list area renders
- Add a new task
- Verify task appears in list
- Toggle task status (complete/incomplete)
- Delete a task
- Verify task is removed

### 6.8 Non-Chat Page Panel Hiding
- Navigate to `/plugins`
- Verify right panel is not rendered
- Navigate to `/settings`
- Verify right panel is not rendered

---

## 7. Skills Editor Tests (V2)

### 7.1 Settings Page Left Navigation
- Navigate to `/settings`
- Verify left navigation shows tab options
- Verify "Skills" tab/trigger is visible

### 7.2 Skills List
- Navigate to `/settings?tab=skills` (or click Skills tab)
- Verify skills list renders with global and project grouping
- Verify each skill shows name, source badge, and description

### 7.3 Skill Search
- Type in skill search input
- Verify list filters by name
- Clear search and verify full list returns

### 7.4 Create New Skill
- Click "New Skill" / "Create" button
- Verify dialog/modal opens
- Fill in skill name and content
- Submit form
- Verify new skill appears in list

### 7.5 Edit Skill Content
- Select a skill from the list
- Verify editor pane shows skill content
- Modify the content
- Verify changes are reflected

### 7.6 Preview Mode
- Switch to preview/read mode
- Verify Markdown content renders correctly
- Switch back to edit mode
- Verify raw markdown is shown

### 7.7 Save Skill
- Edit a skill content
- Click save
- Verify success feedback

### 7.8 Delete Skill
- Hover over a skill in the list
- Click delete button
- Confirm deletion (double-click pattern)
- Verify skill removed from list

### 7.9 Navigation from /plugins
- Navigate to `/plugins`
- Click link/button that navigates to Skills editor
- Verify URL changes to `/settings?tab=skills`

---

## 8. Chat UI Enhanced Tests (V2)

### 8.1 Code Block Display
- Verify code blocks have language label in header bar
- Verify code blocks have syntax highlighting
- Verify copy button is present and functional
- Verify code blocks render with dark background (zinc-800/900)

### 8.2 Tool Call Display
- Verify tool call blocks render with expand/collapse toggle
- Verify "Tool Call" label with blue styling
- Verify "Tool Result" label with green styling
- Verify tool name is displayed
- Expand tool block and verify input/content renders

### 8.3 Message Layout
- Verify user messages show "You" label with User icon
- Verify assistant messages show "Claude" label with Bot icon
- Verify avatar circles render (user: secondary, assistant: primary)

### 8.4 Input Box Features
- Verify textarea placeholder text
- Verify send button renders
- Verify stop button appears during streaming
- Verify input is disabled during streaming

### 8.5 Token Usage
- Verify token usage displays input/output counts
- Verify cache read count when present
- Verify cost display when available

### 8.6 Streaming Status
- Send a message
- Verify streaming state activates
- Verify stop button appears
- Wait for completion
- Verify send button returns

---

## 9. Acceptance Criteria

| Criteria | Threshold |
|----------|-----------|
| Page load time | < 3 seconds |
| No JS console errors | 0 errors on any page |
| Interaction response time | < 500ms |
| Theme switch | No visible flicker |
| Sidebar animation | Smooth (no frame drops) |
| Panel collapse/expand | Smooth transition |
| All E2E tests pass | 100% pass rate |

---

## 10. Test File Structure

```
src/__tests__/
  helpers.ts              - Shared test utilities and helpers
  test-plan.md            - This file
  e2e/
    chat.spec.ts          - Chat flow tests (sections 2.x)
    plugins.spec.ts       - Plugin management tests (sections 3.x)
    settings.spec.ts      - Settings page tests (sections 4.x)
    layout.spec.ts        - Layout functionality tests (sections 5.x)
    project-panel.spec.ts - Project panel tests (sections 6.x) [V2]
    skills.spec.ts        - Skills editor tests (sections 7.x) [V2]
    chat-enhanced.spec.ts - Chat UI enhanced tests (sections 8.x) [V2]
```
