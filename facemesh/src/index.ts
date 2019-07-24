/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

// import * as tfconv from '@tensorflow/tfjs-converter';
import './layers';

import * as tf from '@tensorflow/tfjs-core';
import * as tfl from '@tensorflow/tfjs-layers';

import {Box} from './box';
import {BlazeFaceModel} from './face';
import {BlazePipeline} from './pipeline';

const BLAZEFACE_MODEL_URL =
    'https://facemesh.s3.amazonaws.com/facedetector/rewritten_detector.json';

const BLAZE_MESH_MODEL_PATH =
    'https://facemesh.s3.amazonaws.com/facemesh/model.json';

export async function load() {
  const faceMesh = new FaceMesh();
  await faceMesh.load();
  return faceMesh;
}

export class FaceMesh {
  private pipeline: BlazePipeline;
  private detectionConfidence: number;

  async load(
      meshWidth = 128, meshHeight = 128, maxContinuousChecks = 5,
      detectionConfidence = 0.9) {
    const [blazeFaceModel, blazeMeshModel] =
        await Promise.all([this.loadFaceModel(), this.loadMeshModel()]);

    const blazeface = new BlazeFaceModel(blazeFaceModel, meshWidth, meshHeight);

    this.pipeline = new BlazePipeline(
        blazeface, blazeMeshModel, meshWidth, meshHeight, maxContinuousChecks);

    this.detectionConfidence = detectionConfidence;
  }

  loadFaceModel(): Promise<tfl.LayersModel> {
    return tfl.loadLayersModel(BLAZEFACE_MODEL_URL);
  }

  loadMeshModel(): Promise<tfl.LayersModel> {
    return tfl.loadLayersModel(BLAZE_MESH_MODEL_PATH);
  }

  clearPipelineROIs(flag: number[][]) {
    if (flag[0][0] < this.detectionConfidence) {
      this.pipeline.clearROIs();
    }
  }

  async estimateFace(video: HTMLVideoElement, returnTensors = false): Promise<{
    faceInViewConfidence: number,
    mesh: tf.Tensor2D,
    boundingBox: {topLeft: tf.Tensor2D, bottomRight: tf.Tensor2D}
  }|{
    faceInViewConfidence: number,
    mesh: number[][],
    boundingBox: {topLeft: number[], bottomRight: number[]}
  }> {
    const prediction = tf.tidy(() => {
      const image =
          tf.browser.fromPixels(video).toFloat().expandDims(0) as tf.Tensor4D;
      return this.pipeline.predict(image) as {};
    });

    if (prediction != null) {
      const [coords2dScaled, landmarksBox, flag] =
          prediction as [tf.Tensor2D, Box, tf.Tensor2D];

      if (returnTensors) {
        const flagArr = await flag.array();
        this.clearPipelineROIs(flagArr);

        return {
          faceInViewConfidence: flagArr[0][0],
          mesh: coords2dScaled,
          boundingBox: {
            topLeft: landmarksBox.startPoint,
            bottomRight: landmarksBox.endPoint
          }
        };
      }

      const [coordsArr, topLeft, bottomRight, flagArr] = await Promise.all([
        coords2dScaled, landmarksBox.startPoint, landmarksBox.endPoint, flag
      ].map(async d => await d.array()));

      flag.dispose();
      coords2dScaled.dispose();

      this.clearPipelineROIs(flagArr);

      return {
        faceInViewConfidence: flagArr[0][0],
        mesh: coordsArr,
        boundingBox: {topLeft: topLeft[0], bottomRight: bottomRight[0]}
      };
    }

    // No face in view.
    return null;
  }
}
