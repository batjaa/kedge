import {
  type ReactNode,
} from 'react';
import type { ProjectionAttrs } from '@/lib/projection';

type ProjectionProp = { projectionAttrs?: ProjectionAttrs };
type ProjectionComponent<P extends object> = (props: P & ProjectionProp) => ReactNode;

function isProjectionAttr(name: string): name is `data-${string}` {
  return name.startsWith('data-');
}

function splitProjectionAttrs<P extends object>(
  props: P & ProjectionAttrs & ProjectionProp,
): { rest: P; attrs: ProjectionAttrs } {
  const attrs: ProjectionAttrs = { ...(props.projectionAttrs ?? {}) };
  const rest: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(props)) {
    if (name === 'projectionAttrs') continue;
    if (isProjectionAttr(name)) {
      if (value !== undefined) attrs[name] = String(value);
    } else {
      rest[name] = value;
    }
  }

  return { rest: rest as P, attrs };
}

export function projectionRootProps<P extends object>(
  attrs: ProjectionAttrs | undefined,
  props: P,
): P & ProjectionAttrs {
  return { ...(attrs ?? {}), ...props };
}

/**
 * Apply projection data attributes at the imported-doc component-map boundary.
 * The wrapper is the only place raw `data-*` MDX props are accepted; components
 * receive a typed `projectionAttrs` bundle and apply it to their root with
 * `projectionRootProps`.
 */
export function withProjectionAttrs<P extends object>(
  Component: ProjectionComponent<P>,
): ProjectionComponent<P & ProjectionAttrs> {
  function ProjectionAttrWrapper(props: P & ProjectionAttrs & ProjectionProp): ReactNode {
    const { rest, attrs } = splitProjectionAttrs(props);
    return <Component {...rest} projectionAttrs={attrs} />;
  }

  const componentName = (Component as { displayName?: string; name?: string }).displayName
    ?? Component.name
    ?? 'Component';
  ProjectionAttrWrapper.displayName = `withProjectionAttrs(${componentName})`;
  return ProjectionAttrWrapper;
}
