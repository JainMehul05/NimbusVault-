import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '@context/AuthContext';
import { AskPage } from '@pages/AskPage';
import { api } from '@services/api';

vi.mock('@services/api');

const caps = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  embedding: { configured: true, provider: 'local', model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384 },
  generation: { configured: true, provider: 'openai', model: 'gpt-4o-mini' },
  features: { indexing: true, semanticSearch: true, summaries: true, questionAnswering: true, ocr: false },
  worker: { running: true, concurrency: 1 },
  limits: { maxFileBytes: 1, maxPdfPages: 1, maxExtractedChars: 1, queriesPerWindow: 30, queryWindowMs: 600000 },
  supportedMimeTypes: [],
  privacy: { sendsDocumentsToThirdParty: false, externalProviders: [] },
  ...over,
});

const citation = {
  ref: 'S1', chunkId: 'c1', fileId: 'f1', filename: 'travel-policy.pdf', mimeType: 'application/pdf', folderId: null,
  chunkIndex: 2, pageStart: 3, pageEnd: 3, snippet: 'Hotel reimbursement is capped at €200 per night.', score: 0.82, permission: 'OWNER',
};

const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } });

function mockApi(statusData: unknown, handlers: { ask?: unknown; search?: unknown } = {}) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/ai/status') return ok(statusData) as never;
    if (url === '/files/storage/info') return ok({ quota: '100', used: '1', remaining: '99' }) as never;
    if (url.startsWith('/ai/files/')) return ok({}) as never;
    return ok({}) as never;
  });
  vi.mocked(api.post).mockImplementation((url: string) => {
    if (url === '/ai/ask') return (handlers.ask instanceof Error ? Promise.reject(handlers.ask) : ok(handlers.ask)) as never;
    if (url === '/ai/search') return ok(handlers.search) as never;
    return ok({}) as never;
  });
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <AuthProvider><AskPage /></AuthProvider>
    </MemoryRouter>
  );

describe('AskPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.getItem = vi.fn().mockReturnValue(null);
  });

  it('explains when AI is not configured instead of showing fake results', async () => {
    mockApi(caps({ enabled: false, features: { indexing: false, semanticSearch: false, summaries: false, questionAnswering: false, ocr: false } }));
    renderPage();
    expect(await screen.findByText(/AI features aren’t configured/i)).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('shows a grounded answer with clickable citations and sources', async () => {
    mockApi(caps(), {
      ask: { status: 'answered', answer: 'Hotels are capped at €200 per night [S1].', citations: [citation], sourcesConsidered: 3, model: 'openai:gpt-4o-mini' },
    });
    renderPage();
    const box = await screen.findByLabelText(/your question/i);
    fireEvent.change(box, { target: { value: 'What is the hotel cap?' } });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(await screen.findByText(/Hotels are capped at €200 per night/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/ai/ask', { question: 'What is the hotel cap?', conversationId: undefined, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i) });
    const cite = screen.getByRole('button', { name: /Source S1: travel-policy\.pdf, p\. 3/ });
    expect(cite).toBeInTheDocument();
    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getAllByText('travel-policy.pdf').length).toBeGreaterThan(0);
  });

  it('distinguishes insufficient evidence from an answer', async () => {
    mockApi(caps(), { ask: { status: 'insufficient_evidence', answer: null, citations: [], sourcesConsidered: 0, model: null } });
    renderPage();
    fireEvent.change(await screen.findByLabelText(/your question/i), { target: { value: 'What is the parking policy?' } });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(await screen.findByText(/Not enough evidence in your documents/i)).toBeInTheDocument();
    expect(screen.queryByText('Sources')).not.toBeInTheDocument();
  });

  it('warns when an answer cites no sources', async () => {
    mockApi(caps(), { ask: { status: 'ungrounded', answer: 'Probably €200.', citations: [], sourcesConsidered: 2, model: 'x' } });
    renderPage();
    fireEvent.change(await screen.findByLabelText(/your question/i), { target: { value: 'What is the hotel cap?' } });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(await screen.findByText(/didn’t cite any source/i)).toBeInTheDocument();
  });

  it('shows provider errors without crashing', async () => {
    const err = Object.assign(new Error('x'), { response: { status: 503, data: { message: 'The AI assistant is temporarily unavailable', error: { code: 'AI_PROVIDER_ERROR' } } } });
    mockApi(caps(), { ask: err });
    renderPage();
    fireEvent.change(await screen.findByLabelText(/your question/i), { target: { value: 'What is the hotel cap?' } });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i);
  });

  it('falls back to search when only embeddings are configured, and renders results / empty state', async () => {
    mockApi(
      caps({ generation: { configured: false, provider: null, model: null }, features: { indexing: true, semanticSearch: true, summaries: false, questionAnswering: false, ocr: false } }),
      { search: { results: [citation], model: 'm' } }
    );
    renderPage();
    await waitFor(() => expect(screen.getByRole('tab', { name: /semantic search/i })).toHaveAttribute('aria-selected', 'true'));
    fireEvent.change(screen.getByLabelText(/semantic search query/i), { target: { value: 'accommodation costs' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    const snippet = await screen.findByText(/capped at €200/);
    const card = snippet.closest('button')!;
    expect(within(card).getByText('travel-policy.pdf')).toBeInTheDocument();
    expect(within(card).getByText('82%')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/ai/search', { query: 'accommodation costs', limit: 10, mode: 'hybrid' });
  });
});
