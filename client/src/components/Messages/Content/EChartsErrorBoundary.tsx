import React from 'react';
import CodeBlock from '~/components/Messages/Content/CodeBlock';

interface EChartsErrorBoundaryProps {
  children: React.ReactNode;
  code: string;
}

interface EChartsErrorBoundaryState {
  hasError: boolean;
}

class EChartsErrorBoundary extends React.Component<
  EChartsErrorBoundaryProps,
  EChartsErrorBoundaryState
> {
  constructor(props: EChartsErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): EChartsErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ECharts rendering error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: EChartsErrorBoundaryProps) {
    if (prevProps.code !== this.props.code && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full overflow-hidden rounded-md border border-border-light">
          <CodeBlock
            lang="json"
            codeChildren={this.props.code}
            allowExecution={false}
            blockIndex={0}
            classProp="max-h-[520px]"
          />
        </div>
      );
    }

    return this.props.children;
  }
}

export default EChartsErrorBoundary;
