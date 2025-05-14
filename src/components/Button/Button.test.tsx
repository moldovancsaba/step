import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Button } from './Button';

describe('Button Component', () => {
  test('renders with the provided text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /Click me/i })).toBeInTheDocument();
  });

  test('calls onClick handler when clicked', () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    
    const button = screen.getByRole('button', { name: /Click me/i });
    fireEvent.click(button);
    
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  test('applies custom className correctly', () => {
    render(<Button className="custom-class">Click me</Button>);
    
    const button = screen.getByRole('button', { name: /Click me/i });
    expect(button).toHaveClass('custom-class');
    expect(button).toHaveClass('button'); // Check for the CSS module class
  });

  test('accepts and passes additional props to the button element', () => {
    render(
      <Button data-testid="test-button" disabled>
        Disabled Button
      </Button>
    );
    
    const button = screen.getByTestId('test-button');
    expect(button).toBeDisabled();
  });
});
