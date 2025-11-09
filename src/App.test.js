import { render, screen } from '@testing-library/react';
import App from './App';

test('renders password gate', () => {
  render(<App />);
  const passwordElement = screen.getByText(/Bitte Passwort eingeben/i);
  expect(passwordElement).toBeInTheDocument();
});

test('renders login button', () => {
  render(<App />);
  const loginButton = screen.getByRole('button', { name: /Einloggen/i });
  expect(loginButton).toBeInTheDocument();
});
