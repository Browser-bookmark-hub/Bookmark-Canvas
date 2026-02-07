# Smoke Tests (Chrome MV3)

## Load / Basics
- Load the extension in chrome://extensions with Developer Mode enabled.
- Click the toolbar icon and ensure side panel opens without errors.
- Verify Canvas view is rendered inside the side panel.

## Canvas View
- Verify the canvas loads with grid, zoom controls, and scrollbars.
- Drag the canvas and use zoom in/out buttons.
- Open the help modal and close it.
- Open the manage modal and close it.
- Add a bookmark card to canvas and confirm it appears.

## Search (Canvas)
- Focus the top search input and type a query.
- Confirm suggestions render and can be navigated.
- Clear the search and confirm highlights are removed.

## Favicon Cache (Local + Shared)
- Confirm canvas bookmark icons load favicons.
- If `sharedFaviconHostId` is set, confirm favicon fetch uses shared host (no console errors).
