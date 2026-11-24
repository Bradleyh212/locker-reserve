# LockerReserve CAD Prototype V1

[LockerReserve.FCStd](LockerReserve.FCStd) is the editable FreeCAD assembly. The approved design has a flush, outward-opening door, a left offset hinge, an integrated keeper and an open-top solenoid pocket with a rounded cable notch. The closed assembly measures 151.25 × 96 × 66 mm. Print the frame and door as a matched pair.

## Print files

Import the STLs at 100% scale in millimeters. STL coordinates are unitless. Use the dimensions below to check the import. Both exports contain one closed, connected mesh. The solenoid and tongue are fit references in the native file.

| Part | Dimensions in print orientation (mm) | Orientation |
| --- | --- | --- |
| [Frame](exports/LockerReserve-frame.stl) | 151.25 × 96 × 65 | Base flat on the bed, pocket open upward |
| [Door](exports/LockerReserve-door.stl) | 70 × 60 × 44.25 | Exterior face flat on the bed, keeper and hinge leaf upward |

For an initial unpowered PLA fit print with a 0.4 mm nozzle, start with 0.20 mm layers, four perimeters and 20% infill. Use the filament manufacturer's temperature profile. Inspect the hinge arms, horizontal door pin bore and keeper window in the slicer. Add removable local support where the printer cannot bridge cleanly. Keep the bores, tongue aperture and cable notch accessible for cleanup.

## Assembly and fit checks

1. Bring the door knuckle between the frame bearings and insert a nominal Ø2.0 mm straight metal pin through the Ø2.4 mm bores (0.4 mm diametral allowance). Verify the printed bore and choose the pin length and end retention on the actual assembly.
2. Swing the door through 90° by hand before fitting the solenoid. The CAD sweep gave 0.50 mm minimum door-to-frame clearance. Check for warping and support residue if the hinge binds.
3. With the door open and tongue retracted, lower the 54 × 42 × 30 mm housing into the pocket. Route the leads down into the open-top notch. Check flange, connector and wire clearance against the physical part.
4. During unpowered testing, confirm the keeper meets the bevel on closing, depresses the tongue and clears it, then meets the square face when pulled outward. Nominal keeper projection is 40.25 mm with a 3 mm blade. The modeled maximum depression is 2.79 mm within an 11.4 mm stroke. Closed overlap at the retaining edge is only 1.15 mm. Measure the actual tip projection and verify bevel orientation, spring return and retention with the printed parts. Powered testing requires a rigid mount.

## Export verification

The V1 document was reopened and recomputed. The frame and door each produced one valid solid. Each STL was regenerated from its printable body alone, reopened, and checked for watertightness and a single connected component. Checks on the reimported meshes confirmed material in the door's rear retaining bar and clearance in its window, plus an empty housing pocket and cable passage in the frame.
