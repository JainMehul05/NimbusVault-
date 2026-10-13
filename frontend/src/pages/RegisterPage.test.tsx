import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '@context/AuthContext';
import RegisterPage from '@pages/RegisterPage';
import { api } from '@services/api';

vi.mock('@services/api');

const renderWithProviders = (component: React.ReactNode) => {
  return render(
    <BrowserRouter>
      <AuthProvider>{component}</AuthProvider>
    </BrowserRouter>
  );
};

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.getItem = vi.fn().mockReturnValue(null);
  });

  it('renders register form with all fields', () => {
    renderWithProviders(<RegisterPage />);

    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/create access key/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start building/i })).toBeInTheDocument();
  });

  it('shows error when password is too short', async () => {
    renderWithProviders(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/create access key/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /start building/i }));

    await waitFor(() => {
      expect(screen.getByText(/use at least 8 characters/i)).toBeInTheDocument();
    });
  });

  it('calls register API on valid submit', async () => {
    const mockRegister = vi.fn().mockResolvedValue({ 
      data: { 
        success: true, 
        data: { 
          user: { id: '1', name: 'Test', email: 'test@example.com' }, 
          tokens: { accessToken: 'at', refreshToken: 'rt', tokenFamily: 'tf', expiresIn: 3600 } 
        } 
      } 
    });
    vi.mocked(api.post).mockImplementation(mockRegister);

    renderWithProviders(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/create access key/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /start building/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('/auth/register', {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });
    });
  });
});