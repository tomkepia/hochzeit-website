import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

// Helper function to render App with Router
const renderWithRouter = (initialEntries = ['/']) => {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>
  );
};

test('renders password gate on main page', () => {
  renderWithRouter(['/']);
  const passwordElement = screen.getByText(/Bitte Passwort eingeben/i);
  expect(passwordElement).toBeInTheDocument();
});

test('renders login button on main page', () => {
  renderWithRouter(['/']);
  const loginButton = screen.getByRole('button', { name: /Einloggen/i });
  expect(loginButton).toBeInTheDocument();
});

test('renders admin password gate on admin page', () => {
  renderWithRouter(['/admin']);
  const adminPasswordElement = screen.getByText(/Admin-Zugang/i);
  expect(adminPasswordElement).toBeInTheDocument();
});
