import type { Direction } from "./data";
import { roadShapeByDirection as sharedRouteShapes } from "../shared/routeShapes.mjs";

export const roadShapeByDirection: Record<Direction, [number, number][]> = sharedRouteShapes;
