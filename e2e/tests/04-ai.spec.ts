import { expect, test } from '@playwright/test'
import { API, apiShare, apiUpload, bearer, newAccount, rowAction, textFile, uploadViaUi, watchErrors, type Account } from './helpers'

/** Real local MiniLM embeddings. The first run downloads the model, so allow time for it. */
test.describe.configure({ timeout: 300_000 })

const DOCS: Record<string, string> = {
  'travel-policy.md': '# Travel policy\n\nHotel reimbursement is capped at 180 dollars per night in major cities. Economy flights must be booked two weeks ahead. Meals are reimbursed up to 60 dollars per day with receipts.',
  'onboarding.txt': 'New employees receive a laptop on their first day. The IT helpdesk creates email accounts and enrols security keys. Mentors are assigned for the first three months.',
  'recipe.txt': 'Preheat the oven to 220 degrees. Knead the dough for ten minutes, let it rise for an hour, then bake the sourdough loaf until the crust is deep brown.',
  'security.txt': 'Report a lost badge or stolen device to the security desk immediately. Passwords must never be shared. Visitors must be escorted at all times.',
  'astronomy.txt': 'Jupiter is the largest planet in the solar system. Its Great Red Spot is a storm that has lasted for centuries. Saturn is known for its rings of ice.',
}

test.describe.serial('document intelligence', () => {
  let alice: Account
  let bob: Account

  test('upload, index and find by meaning', async ({ browser, request }) => {
    alice = await newAccount(browser, request, 'Alice Ai')
    bob = await newAccount(browser, request, 'Bob Ai')
    const errors = watchErrors(alice.page)
    await alice.page.goto('/files')
    await uploadViaUi(alice.page, Object.entries(DOCS).map(([n, c]) => textFile(n, c)))
    await expect(alice.page.getByText('AI ready')).toHaveCount(Object.keys(DOCS).length, { timeout: 280_000 })

    await alice.page.goto('/ask')
    await alice.page.getByRole('tab', { name: 'Semantic search' }).click()
    await alice.page.getByLabel('Semantic search query').fill('how much can I spend on accommodation')
    await alice.page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(alice.page.getByText('travel-policy.md').first()).toBeVisible()
    expect(errors).toEqual([])
  })

  test('ranks the right document first for paraphrased questions', async ({ request }) => {
    const cases: Array<[string, string]> = [
      ['nightly lodging cost limit', 'travel-policy.md'],
      ['what equipment do I get when I start the job', 'onboarding.txt'],
      ['how do I bake bread', 'recipe.txt'],
      ['someone took my phone, who should I tell', 'security.txt'],
      ['biggest planet', 'astronomy.txt'],
    ]
    let correct = 0
    for (const [query, expected] of cases) {
      const res = await (await request.post(`${API}/ai/search`, { headers: bearer(alice), data: { query } })).json()
      if (res.data.results[0]?.filename === expected) correct++
      else console.log(`relevance miss: "${query}" → ${res.data.results[0]?.filename ?? 'nothing'} (expected ${expected})`)
    }
    expect(correct).toBe(cases.length)
    const off = await (await request.post(`${API}/ai/search`, { headers: bearer(alice), data: { query: 'quarterly semiconductor export tariffs' } })).json()
    expect(off.data.results.filter((r: { score: number }) => r.score > 0.4)).toEqual([])
  })

  test('document insights show real extraction details', async () => {
    await alice.page.goto('/files')
    await rowAction(alice.page, 'travel-policy.md', 'Document insights')
    const dialog = alice.page.getByRole('dialog')
    await expect(dialog).toContainText('travel-policy.md')
    await expect(dialog).toContainText(/Hotel reimbursement|characters|passages/i)
    await alice.page.keyboard.press('Escape')
  })

  test('without a generation provider, answers are reported unavailable, never invented', async ({ request }) => {
    await alice.page.goto('/ask')
    await alice.page.getByRole('tab', { name: 'Ask a question' }).click()
    await expect(alice.page.getByText('Question answering isn’t available')).toBeVisible()
    const res = await request.post(`${API}/ai/ask`, { headers: bearer(alice), data: { question: 'What is the hotel limit?' } })
    expect(res.status()).toBe(503)
    expect((await res.json()).error.code).toBe('AI_PROVIDER_UNAVAILABLE')
  })

  test('search never crosses accounts; sharing opens it and revoking closes it at once', async ({ request }) => {
    const search = async (a: Account) => (await (await request.post(`${API}/ai/search`, { headers: bearer(a), data: { query: 'hotel reimbursement limit' } })).json()).data.results as Array<{ filename: string; fileId: string }>
    expect(await search(bob)).toEqual([])
    const file = (await search(alice))[0].fileId
    await apiShare(request, alice, 'FILE', file, bob, 'VIEWER')
    expect((await search(bob)).map((r) => r.fileId)).toContain(file)
    await request.delete(`${API}/sharing/FILE/${file}/${bob.id}`, { headers: bearer(alice) })
    expect(await search(bob)).toEqual([])
    for (const p of ['', '/text', '/chunks/0']) expect((await request.get(`${API}/ai/files/${file}${p}`, { headers: bearer(bob) })).status()).toBe(404)

    await request.delete(`${API}/files/${file}`, { headers: bearer(alice) })
    expect((await search(alice)).map((r) => r.fileId)).not.toContain(file)
  })

  test('unsupported files say so', async ({ request }) => {
    const id = await apiUpload(request, alice, 'empty-ish.txt', '   \n  ')
    await expect.poll(async () => (await (await request.get(`${API}/ai/files/${id}`, { headers: bearer(alice) })).json()).data.status, { timeout: 60_000 }).toBe('unsupported')
  })
})
