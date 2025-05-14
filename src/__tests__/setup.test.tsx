import React from 'react';
import { render, screen } from '@testing-library/react';

/**
 * Props for the TestComponent
 */
interface TestComponentProps {
  /** Message to display in the component */
  message: string;
}

/**
 * A simple component used for testing purposes
 * @param props - Component properties
 * @returns React component
 */
const TestComponent: React.FC<TestComponentProps> = ({ message }) => (
  <div data-testid="test-component">{message}</div>
);

describe('Testing Environment Setup', () => {
  it('renders a component correctly', () => {
    const testMessage = 'Testing environment is working!';
    
    render(<TestComponent message={testMessage} />);
    
    // Check if the component is rendered with the correct message
    const element = screen.getByTestId('test-component');
    expect(element).toBeInTheDocument();
    expect(element).toHaveTextContent(testMessage);
  });
  
  it('supports basic DOM assertions', () => {
    const { container } = render(<div className="test-class">Test content</div>);
    
    // Basic DOM assertions
    expect(container.querySelector('.test-class')).toBeInTheDocument();
    expect(container.textContent).toContain('Test content');
  });
  
  it('handles snapshot testing', () => {
    const { asFragment } = render(<TestComponent message="Snapshot test" />);
    
    // Snapshot testing
    expect(asFragment()).toMatchSnapshot();
  });
});
