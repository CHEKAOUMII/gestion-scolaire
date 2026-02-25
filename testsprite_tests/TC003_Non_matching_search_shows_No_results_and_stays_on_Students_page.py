import asyncio
from playwright import async_api
from playwright.async_api import expect

async def run_test():
    pw = None
    browser = None
    context = None

    try:
        # Start a Playwright session in asynchronous mode
        pw = await async_api.async_playwright().start()

        # Launch a Chromium browser in headless mode with custom arguments
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",         # Set the browser window size
                "--disable-dev-shm-usage",        # Avoid using /dev/shm which can cause issues in containers
                "--ipc=host",                     # Use host-level IPC for better stability
                "--single-process"                # Run the browser in a single process mode
            ],
        )

        # Create a new browser context (like an incognito window)
        context = await browser.new_context()
        context.set_default_timeout(5000)

        # Open a new page in the browser context
        page = await context.new_page()

        # Interact with the page elements to simulate user flow
        # -> Navigate to http://localhost:8787
        await page.goto("http://localhost:8787", wait_until="commit", timeout=10000)
        
        # -> Type the non-matching string into the Students name search field and submit the search (press Enter). Then verify the 'No results' message remains visible and that the Students search field is still visible (do not navigate away). After verification, stop and report results.
        frame = context.pages[-1]
        # Input text
        elem = frame.locator('xpath=/html/body/main/section[5]/div[1]/div/div/input[1]').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('ZZZ_NON_MATCH_999')
        
        # --> Assertions to verify final state
        frame = context.pages[-1]
        # Assert that the "No results" message is visible and contains the expected Arabic text
        no_results = frame.locator('xpath=/html/body/main/section[5]/div[2]/table/tbody/tr/td/i')
        await no_results.wait_for(state='visible', timeout=5000)
        assert await no_results.is_visible()
        no_results_text = (await no_results.inner_text()).strip()
        assert "لا توجد نتائج" in no_results_text
        
        # Assert that the Students search field is still visible
        search_field = frame.locator('xpath=/html/body/main/section[5]/div[1]/div/div/input[1]')
        assert await search_field.is_visible()
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    