# Prompts realistas — fonte preservada

Fonte: nota do Apple Notas **Prompts De Imagens Base**, conferida em 05/11/2026, e PDF exportado fornecido pelo Matheus. Texto transcrito do PDF; quebras de linha de paginação reunidas. As imagens de exemplo estão em `exemplos/`. A nota e o PDF são material de referência, não autorização de execução.

Estes são os prompts originais, não um formulário. Antes de gerar, o agente resolve automaticamente `woman/man` e `her/his` pelo contexto fornecido (se não houver, usa `person` e `their`), e troca `@CONTACTSHEET` pelo nome real do asset anexado. Nunca enviar as alternativas com barra ou o token de exemplo ao gerador. Cenários são exemplos completos utilizáveis; alterações solicitadas são registradas no prompt executado, preservando esta fonte.

## closeup

```text
give-me a close up of this woman/man focusing on her/his facial features, iphone camera shoot, sharp and realistic skin, not plastic
```

## facesheet

```text
Create a character identity contact sheet using the attached image as the primary visual reference. Every panel must depict the same single character, preserving the reference's visual style, facial structure, apparent age, skin tone, eye color, hairline, hairstyle, and distinctive visible features.

Arrange six head-and-shoulders portraits in a clean 3-column by 2-row grid: Top row: straight-on front view, three-quarter view facing left, true left profile. Bottom row: three-quarter view facing right, true right profile, rear view of the head showing the hairstyle.

Keep a neutral expression, relaxed mouth, and consistent head scale across all panels. Keep the same visible clothing and accessories. Use a plain light-gray studio background and soft, even lighting so the facial features remain clearly readable.

Treat unseen angles as plausible reconstructions consistent with the attached reference. Preserve natural asymmetries. Avoid beautification, facial redesign, age changes, or hairstyle variations.

Deliver one single contact sheet image with evenly spaced, clearly separated panels. No captions, labels, logos, or watermarks.
```

## bodysheet

```text
Create a full-body character turnaround sheet using the attached image as the primary identity and visual-style reference. Show the same single character in all four panels. Use a clean horizontal layout with four evenly spaced full-body views, ordered from left to right: front view, true left profile, back view, true right profile.

Preserve the reference's face, apparent age, skin tone, hairstyle, and all visible identity features. Preserve clothing and body proportions wherever they are visible in the source image.

The character stands upright in a relaxed neutral pose, arms slightly separated from the torso, hands relaxed, feet fully visible. Use consistent character height, a shared ground line, matching proportions, and the same camera elevation in every panel. Use a neutral camera perspective without wide-angle distortion.

Plain light-gray studio background, soft even lighting, subtle contact shadows beneath the feet. Match the rendering style of the attached reference.

Deliver one single turnaround sheet image. Keep generous margins above the head and below the feet. No cropped limbs, extra characters, props, captions, labels, logos, or watermarks.

4k, UHD
```

## reactselfie

```text
Use @CONTACTSHEET as the only reference image. Preserve the avatar’s exact identity, face, facial structure, skin tone, age, hairstyle, hair texture, body proportions, body size, and clothing.

Create a vertical 9:16 ultra-realistic handheld smartphone selfie. The avatar is indoors, holding the phone with one arm extended forward toward the camera. The arm should be visible entering from the lower-left edge of the frame and naturally cropped, giving a believable real selfie composition. The avatar looks straight into the lens. Camera is positioned near eye level, close to the face, with realistic front-camera smartphone wide-angle perspective. Frame the avatar from the waist or upper thighs up to above the head.

Place the avatar in a warm natural-health room that feels like a small herbal kitchen or apothecary corner inside an American suburban home. On the left side, include a tall white-framed window with bright sunlight entering, and outside show a calm suburban backyard with trees, lawn, and fencing. Behind and to the right of the avatar, include wooden shelves and a small wooden cabinet displaying multiple glass jars filled with dried herbs and roots, a few amber bottles, white ceramic pots with green plants, and a clearly visible small United States flag placed somewhere in the background. Keep the room warm and clean, with soft cream walls and light wooden flooring.

The avatar should occupy the central area of the composition while enough of the background remains visible to establish the environment. Daylight should come mainly from the left and naturally light the avatar’s face, hair, clothing, and skin. Authentic iPhone selfie aesthetic, realistic handheld feel, subtle front-camera lens distortion, realistic skin pores and wrinkles, natural facial texture, crisp but natural detail, photorealistic, not stylized, not cinematic.

IMPORTANT: this must remain a real selfie. Keep the extended arm and handheld perspective. Do not create a formal portrait, tripod shot, or third-person camera angle.

No text, no captions, no subtitles, no watermark, no logos, no extra people.
```

## frontal

```text
Use @CONTACTSHEET as the only reference image. Preserve the avatar’s exact identity, face, facial structure, skin tone, age appearance, hairstyle, hair texture, body proportions, body size, clothing, and accessories.

Create a vertical 9:16 ultra-realistic smartphone portrait of the avatar standing against a plain, warm off-white wall, facing directly toward the camera. The avatar has a natural, relaxed standing posture, shoulders straight, arms resting comfortably at the sides, and a gentle, friendly smile with direct eye contact. Position the camera directly in front of the avatar at eye level, approximately 2–3 meters away. Use a perfectly straight-on, symmetrical composition with no head tilt or body rotation.

Frame the avatar in a nearly full-body portrait, from just below the knees to well above the head, centered horizontally. Keep the entire head, shoulders, arms, hands, torso, hips, and most of the legs visible, with approximately 10% empty space above the head. Maintain natural body proportions without cropping the hands or distorting the legs. Use soft, evenly distributed natural daylight, subtle realistic shadows, and a clean, neutral background.

Ultra-realistic, authentic iPhone camera look, sharp focus, natural skin texture, realistic fabric details, natural exposure, not stylized, not cartoon, not CGI.

No changes to the avatar’s identity or clothing, no added accessories or props, no furniture, no extra people, no text, no watermark, no logos.
```

## frontalcenario

```text
Use @CONTACTSHEET as the only reference image. Preserve the avatar’s exact identity, face, facial structure, skin tone, age appearance, hairstyle, hair texture, body proportions, body size, and clothing.

Create a vertical 9:16 ultra-realistic smartphone photo of the avatar standing behind a rustic wooden kitchen island in a bright, cozy home kitchen. The avatar is not holding anything. No book in the hands and no book anywhere in the scene. The avatar should have a natural instructional posture, with the hands resting naturally on the table or making a subtle explaining gesture, and the expression should feel calm and confident.

The setting is a warm kitchen interior with white paneled cabinets in the background, wooden cutting boards resting near the back counter, a coffee maker on the left side, and wooden floating shelves on the right containing glass jars filled with herbs, roots, dried ingredients, and a few brown apothecary bottles. On the far right, include a tall wood-trimmed window with soft daylight entering. Also include a small United States flag clearly visible somewhere in the environment, such as on the shelf or countertop.

On the wooden island in the foreground, include a few simple ingredients arranged naturally: one brown egg, a small bowl with white liquid, a small bowl with pale green liquid or gel, a small bowl with white powder, and a metal mixing bowl partially visible on the left edge.

Frame the avatar approximately from mid-thigh or waist up to above the head, centered slightly to the right, with the kitchen environment clearly visible around them. Bright soft daylight should illuminate the scene naturally, with realistic shadows and highlights on the avatar, clothing, skin, and kitchen surfaces.

Ultra-realistic, authentic iPhone camera look, sharp focus, photorealistic skin texture, realistic fabric texture, natural exposure, realistic indoor daylight, not stylized, not cartoon.

No book, no subtitles, no captions, no on-screen text, no watermark, no logos, no extra people.
```
