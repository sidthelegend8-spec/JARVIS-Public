/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import VoiceInterface from './components/VoiceInterface';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary>
      <VoiceInterface />
    </ErrorBoundary>
  );
}

