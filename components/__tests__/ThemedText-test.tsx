import * as React from 'react';
import { render } from '@testing-library/react-native';

import { ThemedText } from '../ThemedText';

it(`renders correctly`, () => {
  // react-test-renderer's create() no longer renders synchronously under React 19;
  // RNTL's render() wraps it in act().
  const tree = render(<ThemedText>Snapshot test!</ThemedText>).toJSON();

  expect(tree).toMatchSnapshot();
});
