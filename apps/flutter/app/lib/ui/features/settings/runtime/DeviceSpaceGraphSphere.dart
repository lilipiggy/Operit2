// ignore_for_file: file_names

part of 'DeviceSpaceGraph.dart';

/// A lit sphere and a raised glyph share the orbital pose and interaction lift.
class _GraphDeviceSphere extends StatelessWidget {
  const _GraphDeviceSphere({
    required this.diameter,
    required this.icon,
    required this.iconSize,
    required this.current,
    required this.online,
    required this.motion,
    required this.elevation,
    required this.frame,
  });

  final double diameter;
  final IconData icon;
  final double iconSize;
  final bool current;
  final bool online;
  final Listenable motion;
  final Animation<double> elevation;
  final ValueGetter<_GraphNodeFrame> frame;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final palette = _GraphPalette(scheme);
    final accent = current || online ? scheme.primary : scheme.outline;
    final glyphColor = current
        ? palette.glyphCurrent()
        : palette.glyphRemote(online: online);
    final animation = Listenable.merge([motion, elevation]);
    return ExcludeSemantics(
      child: SizedBox.square(
        dimension: diameter,
        child: Stack(
          clipBehavior: Clip.none,
          children: <Widget>[
            Positioned.fill(
              child: CustomPaint(
                painter: _GraphSpherePainter(
                  scheme: scheme,
                  current: current,
                  online: online,
                  elevation: elevation,
                  frame: frame,
                  animation: animation,
                ),
              ),
            ),
            Positioned.fill(
              child: AnimatedBuilder(
                animation: animation,
                child: _GraphRaisedGlyph(
                  icon: icon,
                  size: iconSize,
                  color: glyphColor,
                  accent: accent,
                  shadow: scheme.shadow,
                ),
                builder: (context, child) {
                  final pose = frame();
                  final lift = elevation.value;
                  final tilt = Matrix4.identity()
                    ..setEntry(3, 2, 0.0018)
                    ..rotateX(-0.18 + pose.depth * 0.07 - lift * 0.04)
                    ..rotateY(-0.18 + pose.lateral * 0.2)
                    ..rotateZ(-0.035 + pose.lateral * 0.025);
                  return Transform.translate(
                    offset: Offset(
                      (-0.012 + pose.lateral * 0.024) * diameter,
                      (-0.022 - lift * 0.021 + pose.depth * 0.008) * diameter,
                    ),
                    child: Transform(
                      alignment: Alignment.center,
                      transform: tilt,
                      child: Center(child: child),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Stacked silhouettes form the side wall, bevel and illuminated icon face.
class _GraphRaisedGlyph extends StatelessWidget {
  const _GraphRaisedGlyph({
    required this.icon,
    required this.size,
    required this.color,
    required this.accent,
    required this.shadow,
  });

  final IconData icon;
  final double size;
  final Color color;
  final Color accent;
  final Color shadow;

  @override
  Widget build(BuildContext context) {
    final palette = _GraphPalette(Theme.of(context).colorScheme);
    final thickness = size * 0.075;
    final edgeColor = palette.glyphEdge(accent);
    return SizedBox.square(
      dimension: size + thickness * 4,
      child: Stack(
        alignment: Alignment.center,
        clipBehavior: Clip.none,
        children: <Widget>[
          Transform.translate(
            offset: Offset(thickness * 1.2, thickness * 1.9),
            child: Icon(
              icon,
              size: size,
              color: shadow.withValues(alpha: palette.glyphShadow),
              shadows: <Shadow>[
                Shadow(
                  color: shadow.withValues(alpha: palette.dark ? 0.48 : 0.28),
                  blurRadius: thickness * 1.8,
                  offset: Offset(0, thickness * 0.4),
                ),
              ],
            ),
          ),
          for (var layer = 3; layer > 0; layer--)
            Transform.translate(
              offset: Offset(thickness * layer * 0.23, thickness * layer / 3),
              child: Icon(
                icon,
                size: size,
                color: Color.lerp(edgeColor, accent, (3 - layer) * 0.16),
              ),
            ),
          Transform.translate(
            offset: const Offset(-0.45, -0.65),
            child: Icon(
              icon,
              size: size,
              color: Color.lerp(color, Colors.white, palette.glyphHighlight),
            ),
          ),
          ShaderMask(
            blendMode: BlendMode.srcIn,
            shaderCallback: (bounds) => LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: <Color>[
                Color.lerp(color, Colors.white, palette.dark ? 0.8 : 0.22)!,
                color,
                Color.lerp(color, accent, 0.38)!,
              ],
              stops: const <double>[0, 0.5, 1],
            ).createShader(bounds),
            child: Icon(icon, size: size, color: Colors.white),
          ),
        ],
      ),
    );
  }
}

class _GraphSpherePainter extends CustomPainter {
  _GraphSpherePainter({
    required this.scheme,
    required this.current,
    required this.online,
    required this.elevation,
    required this.frame,
    required Listenable animation,
  }) : super(repaint: animation);

  final ColorScheme scheme;
  final bool current;
  final bool online;
  final Animation<double> elevation;
  final ValueGetter<_GraphNodeFrame> frame;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 100, size.height / 100);
    const center = Offset(50, 50);
    const radius = 48.5;
    const sphere = Rect.fromLTWH(1.5, 1.5, 97, 97);
    final pose = frame();
    final lift = elevation.value;
    final palette = _GraphPalette(scheme);
    final accent = current || online ? scheme.primary : scheme.outline;
    final base = palette.sphereBase(current: current, online: online);
    final lit = palette.sphereLit(base, current: current);
    final shade = palette.sphereShade(base);
    final lightPosition = Alignment(
      -0.42 + pose.lateral * 0.18,
      -0.52 + pose.depth * 0.09,
    );
    final lightStrength = 0.84 + pose.depth * 0.12 + lift * 0.08;

    canvas.drawOval(
      Rect.fromCenter(
        center: Offset(54 - pose.lateral * 2, 92 + lift * 2),
        width: 77 - lift * 5,
        height: 20,
      ),
      Paint()
        ..color = scheme.shadow.withValues(alpha: palette.contactShadow)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4),
    );
    canvas.drawCircle(
      center,
      54,
      Paint()
        ..shader = RadialGradient(
          colors: <Color>[
            accent.withValues(alpha: 0),
            accent.withValues(
              alpha: ((current ? 0.14 : 0.05) + lift * 0.09) * palette.aura,
            ),
            accent.withValues(alpha: 0),
          ],
          stops: const <double>[0.66, 0.87, 1],
        ).createShader(Rect.fromCircle(center: center, radius: 54)),
    );

    canvas.saveLayer(
      sphere,
      Paint()..color = Colors.white.withValues(alpha: 0.78),
    );
    canvas.drawCircle(
      center,
      radius,
      Paint()
        ..shader = RadialGradient(
          center: lightPosition,
          radius: 1.08,
          colors: <Color>[
            lit,
            Color.lerp(base, accent, current ? 0.35 : 0.16)!,
            base,
            shade,
          ],
          stops: const <double>[0, 0.24, 0.56, 1],
        ).createShader(sphere),
    );

    canvas.save();
    canvas.clipPath(Path()..addOval(sphere));
    canvas.drawCircle(
      center,
      radius,
      Paint()
        ..shader = RadialGradient(
          center: Alignment(0.28 - pose.lateral * 0.12, 0.85),
          radius: 0.8,
          colors: <Color>[
            accent.withValues(
              alpha: (current ? 0.24 : 0.16) * (palette.dark ? 1 : 0.72),
            ),
            accent.withValues(alpha: 0),
          ],
        ).createShader(sphere),
    );
    final glint = Offset(
      33 + pose.lateral * 7,
      22 + pose.depth * 3 - lift * 1.5,
    );
    canvas.save();
    canvas.translate(glint.dx, glint.dy);
    canvas.rotate(-0.45 + pose.lateral * 0.12);
    canvas.scale(1, 0.56);
    canvas.drawCircle(
      Offset.zero,
      20,
      Paint()
        ..shader = RadialGradient(
          colors: <Color>[
            Colors.white.withValues(alpha: palette.glint * lightStrength),
            Colors.white.withValues(
              alpha: (palette.dark ? 0.17 : 0.08) * lightStrength,
            ),
            Colors.white.withValues(alpha: 0),
          ],
          stops: const <double>[0, 0.35, 1],
        ).createShader(const Rect.fromLTWH(-20, -20, 40, 40)),
    );
    canvas.restore();
    canvas.restore();

    canvas.drawCircle(
      center,
      radius,
      Paint()
        ..shader = SweepGradient(
          colors: <Color>[
            shade.withValues(alpha: 0.85),
            accent.withValues(alpha: 0.6),
            shade.withValues(alpha: 0.48),
            Colors.white.withValues(alpha: palette.rimWhite * lightStrength),
            accent.withValues(alpha: 0.62),
            shade.withValues(alpha: 0.85),
          ],
          stops: const <double>[0, 0.2, 0.46, 0.64, 0.84, 1],
        ).createShader(sphere)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.6 + lift * 0.5,
    );
    canvas.drawArc(
      sphere.deflate(3),
      math.pi * 1.05 + pose.lateral * 0.08,
      math.pi * 0.44,
      false,
      Paint()
        ..color = Colors.white.withValues(alpha: palette.rimArc * lightStrength)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 0.85
        ..strokeCap = StrokeCap.round,
    );
    canvas.restore();
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _GraphSpherePainter oldDelegate) =>
      oldDelegate.scheme != scheme ||
      oldDelegate.current != current ||
      oldDelegate.online != online ||
      oldDelegate.frame != frame ||
      oldDelegate.elevation != elevation;
}
