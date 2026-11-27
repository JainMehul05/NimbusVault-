import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Link } from 'react-router-dom';
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
/** These page tests exercise the synchronous fallback: the async job endpoint reports 404. */
const noAsync = (impl: (url: string) => unknown) => (url: string) =>
  (url === '/ai/ask/async' ? Promise.reject({ response: { status: 404 } }) : impl(url)) as never;

function mockApi(statusData: unknown, handlers: { ask?: unknown; search?: unknown } = {}) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/ai/status') return ok(statusData) as never;
    if (url === '/files/storage/info') return ok({ quota: '100', used: '1', remaining: '99' }) as never;
    if (url.startsWith('/ai/files/')) return ok({}) as never;
    return ok({}) as never;
  });
  vi.mocked(api.post).mockImplementation(noAsync((url: string) => {
    if (url === '/ai/ask') return (handlers.ask instanceof Error ? Promise.reject(handlers.ask) : ok(handlers.ask)) as never;
    if (url === '/ai/search') return ok(handlers.search) as never;
    return ok({}) as never;
  }));
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

  it('keeps conversation controls stable while generation is pending',async()=>{
    mockApi(caps());
    let resolveAsk!:(value:unknown)=>void;
    vi.mocked(api.post).mockImplementation(noAsync(()=>new Promise(resolve=>{resolveAsk=resolve})));
    renderPage();
    fireEvent.change(await screen.findByLabelText(/your question/i),{target:{value:'What is the hotel cap?'}});
    fireEvent.click(screen.getByRole('button',{name:/^ask$/i}));
    expect(screen.getByRole('button',{name:'New conversation'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'History'})).toBeDisabled();
    expect(screen.getByLabelText('Document folder scope')).toBeDisabled();
    await waitFor(()=>expect(typeof resolveAsk).toBe('function'));
    await act(async()=>{resolveAsk({data:{success:true,data:{status:'insufficient_evidence',answer:null,citations:[],sourcesConsidered:0,model:null}}})});
    await waitFor(()=>expect(screen.getByRole('button',{name:'New conversation'})).toBeEnabled());
  });

  it('does not attach a late answer or conversation to a changed document scope',async()=>{
    mockApi(caps());
    let resolveAsk!:(value:unknown)=>void;
    vi.mocked(api.post).mockImplementation(noAsync(()=>new Promise(resolve=>{resolveAsk=resolve})));
    render(<MemoryRouter><AuthProvider><Link to="/ask?fileId=f2">Next document</Link><AskPage /></AuthProvider></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText(/your question/i),{target:{value:'Original question'}});
    fireEvent.click(screen.getByRole('button',{name:/^ask$/i}));
    fireEvent.click(screen.getByRole('link',{name:'Next document'}));
    await screen.findByText('Selected document only');
    await act(async()=>{resolveAsk({data:{success:true,data:{status:'answered',answer:'Late answer from the old scope.',citations:[],conversationId:'old-conversation',sourcesConsidered:0,model:'local'}}})});
    expect(screen.queryByText(/Late answer from the old scope/)).not.toBeInTheDocument();
    vi.mocked(api.post).mockImplementation(noAsync(()=>ok({status:'insufficient_evidence',answer:null,citations:[],sourcesConsidered:0,model:null})));
    fireEvent.change(screen.getByLabelText(/your question/i),{target:{value:'New scope question'}});
    fireEvent.click(screen.getByRole('button',{name:/^ask$/i}));
    await waitFor(()=>expect(api.post).toHaveBeenLastCalledWith('/ai/ask',expect.objectContaining({question:'New scope question',conversationId:undefined,fileIds:['f2']})));
  });

  it('prepares answers as a polled background job when the server supports it', async () => {
    mockApi(caps());
    vi.mocked(api.post).mockImplementation(((url: string) =>
      url === '/ai/ask/async' ? ok({ jobId: '11111111-1111-4111-8111-111111111111', state: 'running' }) : ok({})) as never);
    let polls = 0;
    vi.mocked(api.get).mockImplementation(((url: string) => {
      if (url === '/ai/status') return ok(caps());
      if (url.startsWith('/ai/ask/async/')) {
        polls += 1;
        return ok(polls < 2 ? { state: 'running' } : { state: 'done', result: { status: 'answered', answer: 'Polled answer about hotels [S1].', citations: [citation], sourcesConsidered: 1, model: 'local' } });
      }
      return ok({});
    }) as never);
    renderPage();
    fireEvent.change(await screen.findByLabelText(/your question/i), { target: { value: 'What is the hotel cap?' } });
    fireEvent.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(await screen.findByText(/Polled answer about hotels/, {}, { timeout: 8000 })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/ai/ask/async', expect.objectContaining({ question: 'What is the hotel cap?' }));
    expect(polls).toBeGreaterThanOrEqual(2);
  }, 12000);

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
